import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { test } from "node:test";
import { SetupError } from "../src/host/setup-error.js";
import { startAgentWithRider } from "../src/lanes/rider-dispatch.js";

type Received = { readonly method: string; readonly session: string | undefined; readonly version: string | undefined; readonly params: unknown };

/** A fake Rider MCP server: answers initialize, accepts the notification and answers tools/call with the scripted result. */
async function fakeRider(toolResult: unknown, stream = false): Promise<{ endpoint: string; received: Received[]; server: Server }> {
  const received: Received[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    let body = "";
    request.on("data", (chunk) => (body += chunk));
    request.on("end", () => {
      const message = JSON.parse(body) as { id?: number; method: string; params?: unknown };
      received.push({
        method: message.method, session: request.headers["mcp-session-id"] as string | undefined,
        version: request.headers["mcp-protocol-version"] as string | undefined, params: message.params,
      });
      if (message.id === undefined) {
        response.writeHead(202).end();
        return;
      }
      const result = message.method === "initialize"
        ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "rider", version: "1" } }
        : toolResult;
      const reply = JSON.stringify({ jsonrpc: "2.0", id: message.id, result });
      if (stream && message.method === "tools/call") {
        response.writeHead(200, { "content-type": "text/event-stream", "mcp-session-id": "s-1" });
        response.end(`event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\n\nevent: message\ndata: ${reply}\n\n`);
      } else {
        response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "s-1" }).end(reply);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { endpoint: `http://127.0.0.1:${address.port}/stream`, received, server };
}

const entry = (endpoint: string) => ({ endpoint, rootFolder: "E:/repo", configuration: "Lane agent" });

function started(text: string) {
  return { content: [{ type: "text", text }], isError: false };
}

test("the agent is started by executing the run configuration without waiting, with the lane folder in its environment", async () => {
  const rider = await fakeRider(started(JSON.stringify({ output: "", sessionId: "Lane agent" })));
  try {
    await startAgentWithRider(entry(rider.endpoint), "E:/lanes/vm");
    deepStrictEqual(rider.received.map((message) => message.method), ["initialize", "notifications/initialized", "tools/call"]);
    deepStrictEqual(rider.received.map((message) => message.session), [undefined, "s-1", "s-1"]);
    equal(rider.received[2]!.version, "2025-03-26");
    deepStrictEqual(rider.received[2]!.params, {
      name: "execute_run_configuration",
      arguments: { configurationName: "Lane agent", rootFolder: "E:/repo", waitForExit: false, envs: { LANE_AGENT_FOLDER: "E:/lanes/vm" } },
    });
  } finally {
    rider.server.close();
  }
});

test("an event-stream answer and structured content are read", async () => {
  const rider = await fakeRider({ content: [{ type: "text", text: "not json" }], isError: false, structuredContent: { output: "", sessionId: "x" } }, true);
  try {
    await startAgentWithRider(entry(rider.endpoint), "E:/lanes/vm");
  } finally {
    rider.server.close();
  }
});

test("a tool error, an agent that ended at once and an unreadable result are setup errors with what Rider returned", async () => {
  const cases: [unknown, RegExp][] = [
    [{ content: [{ type: "text", text: "Run configuration 'Lane agent' not found" }], isError: true }, /could not execute the run configuration Lane agent.*not found/],
    [started(JSON.stringify({ exitCode: 3, output: "Setup error: Another lane agent serves" })), /ended at once with exit 3: Setup error: Another lane agent/],
    [started("plain words"), /not JSON: plain words/],
  ];
  for (const [result, pattern] of cases) {
    const rider = await fakeRider(result);
    try {
      await rejects(startAgentWithRider(entry(rider.endpoint), "E:/lanes/vm"), (error: Error) => error instanceof SetupError && pattern.test(error.message));
    } finally {
      rider.server.close();
    }
  }
});

test("an endpoint nobody listens on is a setup error naming it", async () => {
  const rider = await fakeRider(started("{}"));
  const { endpoint } = rider;
  await new Promise((resolve) => rider.server.close(resolve));
  await rejects(startAgentWithRider(entry(endpoint), "E:/lanes/vm"), (error: Error) => error instanceof SetupError && error.message.includes(`${endpoint} cannot be reached`));
});

test("a JSON-RPC error is a setup error", async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "bad request" } }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  ok(address !== null && typeof address !== "string");
  try {
    await rejects(startAgentWithRider(entry(`http://127.0.0.1:${address.port}/stream`), "E:/lanes/vm"), /refused initialize: bad request/);
  } finally {
    server.close();
  }
});

test("a response whose body fails while it is read is a setup error", async () => {
  const failing = async () => new Response(new ReadableStream({
    pull(controller) {
      controller.error(new Error("the stream was reset"));
    },
  }), { status: 200, headers: { "content-type": "application/json" } });
  await rejects(startAgentWithRider(entry("http://127.0.0.1:1/stream"), "E:/lanes/vm", undefined, failing as unknown as typeof fetch),
    (error: Error) => error instanceof SetupError && /did not deliver its response: the stream was reset/.test(error.message));
});