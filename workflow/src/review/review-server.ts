import { existsSync, readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { BenchmarkItem } from "../evals/benchmark.js";
import { listRecords, setLabels, verdicts, type EvalRecord } from "../evals/eval-record.js";
import { isGradable } from "../evals/hindsight.js";
import { challengedHypothesis, recordContext } from "../evals/record-context.js";
import { reviewQueue, type QueueOptions } from "../evals/review-queue.js";
import { escapeHtml, queuePage, recordLink, recordPage } from "./review-pages.js";

export type ReviewDependencies = {
  readonly store: BaseStore;
  readonly threadFolder: (threadId: string) => string;
  readonly benchmark: () => readonly BenchmarkItem[];
  readonly queue: QueueOptions;
  /** Who gives the verdicts: the OS user. */
  readonly reviewer: string;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** The largest verdict form the page accepts. */
const maximumBody = 64 * 1024;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function send(response: ServerResponse, status: number, type: string, body: string | Buffer): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  response.end(body);
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > maximumBody) reject(new HttpError(413, "The form is too large."));
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

/** The cluster's check in the thread's `diagnosis.json`, or null. */
function clusterCheck(threadFolder: string, clusterId: string): unknown {
  const path = join(threadFolder, "diagnosis.json");
  if (!existsSync(path)) return null;
  const document = JSON.parse(readFileSync(path, "utf8")) as { clusters?: { clusterId: string; check: unknown }[] };
  return document.clusters?.find((cluster) => cluster.clusterId === clusterId)?.check ?? null;
}

/** The review page: the queue, one record at a time, its evidence images and the verdict form. Serve it on 127.0.0.1 only. */
export function createReviewServer(dependencies: ReviewDependencies): Server {
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
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
      send(response, 200, "text/html; charset=utf-8", recordPage({
        record, manifest: found.manifest,
        hypothesis: record.jobKind === "challenge" ? challengedHypothesis(all, record)?.explanation ?? null : null,
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
