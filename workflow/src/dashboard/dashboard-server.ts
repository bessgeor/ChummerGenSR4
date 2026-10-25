import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { HttpError, requireOwnOrigin } from "../review/http-error.js";
import { applyControl, ControlRequestSchema } from "./controls.js";
import { takeSnapshot, type DashboardSources } from "./dashboard-data.js";
import type { GraphDrawings } from "./snapshot.js";
import { z } from "zod";

export type DashboardDependencies = DashboardSources & {
  /** The client bundle, built once when the server starts. */
  readonly bundle: string;
  readonly log: (line: string) => void;
};

/** The largest control request the server accepts. */
const maximumBody = 4 * 1024;

function send(response: ServerResponse, status: number, type: string, body: string): void {
  response.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(body);
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  send(response, status, "application/json; charset=utf-8", JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > maximumBody) {
        request.destroy();
        reject(new HttpError(413, "The request is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sameToken(given: string | undefined, expected: string): boolean {
  const left = Buffer.from(given ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** The page: a shell that carries this server's token and loads the React bundle. */
export function shellPage(token: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta name="dashboard-token" content="${token}"><title>Loop dashboard</title></head>`
    + `<body><div id="root"></div><script type="module" src="/app.js"></script></body></html>`;
}

/** The dashboard: the page, its bundle, the snapshot, the graphs' drawings and the pause and resume controls. Serve it on 127.0.0.1 only. */
export function createDashboardServer(dependencies: DashboardDependencies): Server {
  // Every control carries this token; one without it, such as a request another site's page makes, is refused.
  const token = randomBytes(24).toString("hex");
  const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    requireOwnOrigin(request);
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/") {
      send(response, 200, "text/html; charset=utf-8", shellPage(token));
      return;
    }
    if (request.method === "GET" && url.pathname === "/app.js") {
      send(response, 200, "text/javascript; charset=utf-8", dependencies.bundle);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/snapshot") {
      sendJson(response, 200, await takeSnapshot(dependencies, url.searchParams.get("loop")));
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/graphs") {
      const drawings: Record<string, string> = {};
      for (const reader of dependencies.graphs) drawings[reader.source.kind] = await reader.drawing();
      sendJson(response, 200, drawings satisfies GraphDrawings);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/control") {
      const header = request.headers["x-dashboard-token"];
      if (!sameToken(typeof header === "string" ? header : undefined, token)) throw new HttpError(403, "The control does not carry this page's token; reload the page.");
      let body: unknown;
      try {
        body = JSON.parse(await readBody(request));
      } catch (error) {
        if (error instanceof HttpError) throw error;
        throw new HttpError(400, "The control is not JSON.");
      }
      const parsed = ControlRequestSchema.safeParse(body);
      if (!parsed.success) throw new HttpError(400, `The control is not valid: ${z.prettifyError(parsed.error)}`);
      const control = applyControl(dependencies.loopRoot, parsed.data, dependencies.now());
      const { loop, lane, paused } = parsed.data;
      dependencies.log(`Dashboard: ${paused ? "paused" : "resumed"} ${lane === null ? "loop" : `lane ${lane} of loop`} ${loop}.`);
      sendJson(response, 200, control);
      return;
    }
    throw new HttpError(404, "Not found.");
  };
  return createServer((request, response) => {
    handle(request, response).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500;
      if (status === 500) dependencies.log(`Dashboard error: ${(error as Error).stack ?? String(error)}`);
      if (!response.headersSent) sendJson(response, status, { error: (error as Error).message });
    });
  });
}
