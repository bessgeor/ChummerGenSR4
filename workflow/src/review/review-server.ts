import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { listRecords, setLabels, verdicts, type EvalRecord } from "../evals/eval-record.js";
import { isGradable } from "../evals/hindsight.js";
import { challengedHypothesis, missingHypothesisMessage, recordContext } from "../evals/record-context.js";
import { reviewQueue } from "../evals/review-queue.js";
import { clusterCheck } from "./cluster-check.js";
import { HttpError } from "./http-error.js";
import type { ReviewDependencies } from "./review-dependencies.js";
import { escapeHtml, queuePage, recordLink, recordPage } from "./review-pages.js";

/** The largest verdict form the page accepts. */
const maximumBody = 64 * 1024;

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    let tooLarge = false;
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      if (tooLarge) return;
      body += chunk;
      if (body.length > maximumBody) {
        tooLarge = true;
        body = "";
        reject(new HttpError(413, "The form is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

/** A workflow hypothesis or challenge with an answer; anything else is not reviewed here. */
async function reviewable(store: BaseStore, recordId: string | null): Promise<{ record: EvalRecord; all: EvalRecord[] }> {
  const all = await listRecords(store);
  const record = all.find((item) => item.recordId === recordId);
  if (record === undefined || !isGradable(record)) throw new HttpError(404, `No reviewable record ${recordId ?? ""}.`);
  return { record, all };
}

/**
 * A request is accepted only when it names this server by its loopback address (a page that rebinds another name to it does not),
 * and, when the browser says where the request comes from, only from a page of this server.
 */
function requireOwnOrigin(request: IncomingMessage): void {
  const port = request.socket.localPort;
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!own.includes(request.headers.host ?? "")) throw new HttpError(403, "The request does not address this server by its loopback address.");
  const origin = request.headers.origin;
  if (origin !== undefined && !own.some((host) => origin === `http://${host}`)) throw new HttpError(403, "The request comes from another page.");
}

function sameToken(given: string | null, expected: string): boolean {
  const left = Buffer.from(given ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The review page: the queue, one record at a time, its evidence images and the verdict form. Serve it on 127.0.0.1 only. */
export function createReviewServer(dependencies: ReviewDependencies): Server {
  // Every verdict form carries this token; a verdict without it, such as one a page of another site submits, is refused.
  const verdictToken = randomBytes(24).toString("hex");
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    requireOwnOrigin(request);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const id = url.searchParams.get("id");
    if (request.method === "GET" && url.pathname === "/") {
      const records = await listRecords(dependencies.store);
      send(response, 200, "text/html; charset=utf-8", queuePage(reviewQueue(records, dependencies.queue), records.filter((item) => item.labels.review !== null).length));
      return;
    }
    if (request.method === "GET" && url.pathname === "/record") {
      const { record, all } = await reviewable(dependencies.store, id);
      const found = recordContext(dependencies.threadFolder, record);
      const queue = reviewQueue(all, dependencies.queue);
      const position = queue.findIndex((entry) => entry.record.recordId === record.recordId);
      const hypothesis = record.jobKind === "challenge" ? challengedHypothesis(all, record)?.explanation ?? null : null;
      if (record.jobKind === "challenge" && hypothesis === null) throw new HttpError(409, missingHypothesisMessage(record));
      send(response, 200, "text/html; charset=utf-8", recordPage({
        record, manifest: found.manifest, hypothesis, verdictToken,
        check: clusterCheck(dependencies.threadFolder(record.threadId), record.subject.id),
        items: dependencies.benchmark().filter((item) => item.discrepancy.clusterId === record.subject.id),
        position: position < 0 ? null : position, queued: queue.length,
      }));
      return;
    }
    if (request.method === "GET" && url.pathname === "/evidence") {
      const { record } = await reviewable(dependencies.store, id);
      const found = recordContext(dependencies.threadFolder, record);
      const file = url.searchParams.get("file");
      // Only the crops the manifest lists, by their exact listed name; never a path the request builds.
      const listed = found.manifest.members.flatMap((member) => [member.canonicalCrop, member.candidateCrop]).find((crop) => crop === file);
      if (listed === undefined) throw new HttpError(404, "Not a crop of this record.");
      send(response, 200, "image/png", readFileSync(join(found.contextFolder, listed)));
      return;
    }
    if (request.method === "POST" && url.pathname === "/verdict") {
      const form = new URLSearchParams(await readBody(request));
      if (!sameToken(form.get("token"), verdictToken)) throw new HttpError(403, "The verdict does not carry this page's token; open the record from the queue.");
      const verdict = verdicts.find((item) => item === form.get("verdict"));
      if (verdict === undefined) throw new HttpError(400, `The verdict must be one of ${verdicts.join(", ")}.`);
      const { record } = await reviewable(dependencies.store, form.get("id"));
      const note = form.get("note")?.trim() ?? "";
      await setLabels(dependencies.store, record, {
        review: { verdict, note: note.length === 0 ? null : note, reviewer: dependencies.reviewer, reviewedUtc: dependencies.now().toISOString() },
      });
      dependencies.log(`Review: ${record.recordId} ${verdict}${note.length === 0 ? "" : ` (${note})`}.`);
      const next = reviewQueue(await listRecords(dependencies.store), dependencies.queue)[0];
      response.writeHead(303, { location: next === undefined ? "/" : recordLink(next.record.recordId) });
      response.end();
      return;
    }
    throw new HttpError(404, "Not found.");
  };
  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) dependencies.log(`Review page error: ${(error as Error).stack ?? String(error)}`);
      send(response, status, "text/html; charset=utf-8", `<!doctype html><p>${status}: ${escapeHtml((error as Error).message)}</p><p><a href="/">Queue</a></p>`);
    });
  });
}
