import { z } from "zod";
import { SetupError } from "../host/setup-error.js";
import type { RiderEntry } from "./lane-settings.js";

/** How long one request to Rider's MCP server may take. */
const requestTimeoutMilliseconds = 60_000;

const JsonRpcResponseSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const ToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).default([]),
  isError: z.boolean().optional(),
  structuredContent: z.record(z.string(), z.unknown()).optional(),
});

/** `execute_run_configuration`'s result: an exit code only when the process ended before the tool returned. */
const RunConfigurationResultSchema = z.object({
  exitCode: z.number().int().nullable().optional(),
  output: z.string().optional(),
  sessionId: z.string().optional(),
});

type Session = { readonly endpoint: string; id: string | null; protocolVersion: string | null; nextId: number };

/** The JSON-RPC response with the ID from a JSON body or from the events of an event-stream body. */
function responseOf(contentType: string, body: string, id: number): z.infer<typeof JsonRpcResponseSchema> {
  const messages: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    for (const event of body.split(/\r?\n\r?\n/)) {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
      if (data.length > 0) messages.push(JSON.parse(data));
    }
  } else {
    const parsed: unknown = JSON.parse(body);
    messages.push(...(Array.isArray(parsed) ? parsed : [parsed]));
  }
  for (const message of messages) {
    const response = JsonRpcResponseSchema.safeParse(message);
    if (response.success && response.data.id === id) return response.data;
  }
  throw new Error(`no response with ID ${id} in: ${body.slice(0, 500)}`);
}

/** The response's body; a body that does not arrive in time, or when the run stops, is a setup error. */
async function bodyOf(session: Session, response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    throw new SetupError(`Rider's MCP endpoint ${session.endpoint} did not deliver its response: ${(error as Error).message}`);
  }
}

async function post(session: Session, message: Record<string, unknown>, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
  if (session.id !== null) headers["mcp-session-id"] = session.id;
  if (session.protocolVersion !== null) headers["mcp-protocol-version"] = session.protocolVersion;
  const timeout = AbortSignal.timeout(requestTimeoutMilliseconds);
  try {
    return await fetchImpl(session.endpoint, {
      method: "POST", headers, body: JSON.stringify({ jsonrpc: "2.0", ...message }), signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout]),
    });
  } catch (error) {
    throw new SetupError(`Rider's MCP endpoint ${session.endpoint} cannot be reached: ${(error as Error).message}`);
  }
}

/** Calls a method and returns its result; an HTTP failure, an unreadable body or a JSON-RPC error is a setup error. */
async function call(session: Session, method: string, params: Record<string, unknown>, signal: AbortSignal | undefined, fetchImpl: typeof fetch): Promise<unknown> {
  const id = session.nextId++;
  const response = await post(session, { id, method, params }, signal, fetchImpl);
  const body = await bodyOf(session, response);
  if (!response.ok) throw new SetupError(`Rider's MCP endpoint ${session.endpoint} answered ${method} with HTTP ${response.status}: ${body.slice(0, 500)}`);
  session.id ??= response.headers.get("mcp-session-id");
  let parsed;
  try {
    parsed = responseOf(response.headers.get("content-type") ?? "", body, id);
  } catch (error) {
    throw new SetupError(`Rider's MCP endpoint ${session.endpoint} answered ${method} with an unreadable response: ${(error as Error).message}`);
  }
  if (parsed.error !== undefined) throw new SetupError(`Rider's MCP endpoint ${session.endpoint} refused ${method}: ${parsed.error.message} (${parsed.error.code})`);
  return parsed.result;
}

/**
 * Starts a lane folder's agent through Rider: opens an MCP session with the endpoint and executes the entry's run
 * configuration in the entry's project without waiting for it to end, with `LANE_AGENT_FOLDER` set to the folder. A
 * tool error, or a result with an exit code (the agent ended at once), is a setup error with what Rider returned.
 */
export async function startAgentWithRider(entry: RiderEntry, folder: string, signal?: AbortSignal, fetchImpl: typeof fetch = fetch): Promise<void> {
  const session: Session = { endpoint: entry.endpoint, id: null, protocolVersion: null, nextId: 1 };
  const initialized = z.object({ protocolVersion: z.string() }).safeParse(await call(session, "initialize", {
    protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "chummergensr4-workflow", version: "1" },
  }, signal, fetchImpl));
  if (!initialized.success) throw new SetupError(`Rider's MCP endpoint ${entry.endpoint} answered initialize without a protocol version.`);
  session.protocolVersion = initialized.data.protocolVersion;
  const notified = await post(session, { method: "notifications/initialized" }, signal, fetchImpl);
  await bodyOf(session, notified);
  if (!notified.ok) throw new SetupError(`Rider's MCP endpoint ${entry.endpoint} answered notifications/initialized with HTTP ${notified.status}.`);

  const result = ToolResultSchema.safeParse(await call(session, "tools/call", {
    name: "execute_run_configuration",
    arguments: { configurationName: entry.configuration, rootFolder: entry.rootFolder, waitForExit: false, envs: { LANE_AGENT_FOLDER: folder } },
  }, signal, fetchImpl));
  if (!result.success) throw new SetupError(`Rider answered execute_run_configuration with an unreadable result: ${z.prettifyError(result.error)}`);
  const text = result.data.content.flatMap((item) => (item.text === undefined ? [] : [item.text])).join("\n");
  if (result.data.isError === true) throw new SetupError(`Rider could not execute the run configuration ${entry.configuration} in ${entry.rootFolder}: ${text}`);
  let structured: unknown = result.data.structuredContent;
  if (structured === undefined) {
    try {
      structured = JSON.parse(text);
    } catch {
      throw new SetupError(`Rider answered execute_run_configuration with a result that is not JSON: ${text.slice(0, 500)}`);
    }
  }
  const run = RunConfigurationResultSchema.safeParse(structured);
  if (!run.success) throw new SetupError(`Rider answered execute_run_configuration with an unreadable result: ${text.slice(0, 500)}`);
  if (run.data.exitCode !== undefined && run.data.exitCode !== null) {
    throw new SetupError(`The run configuration ${entry.configuration} ended at once with exit ${run.data.exitCode}: ${(run.data.output ?? "").slice(0, 2000)}`);
  }
}
