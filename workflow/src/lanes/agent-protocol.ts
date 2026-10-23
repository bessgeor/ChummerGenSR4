import { randomUUID } from "node:crypto";
import { readFile, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

/** How often a lane agent refreshes `agent.json`, and after how long without a refresh it counts as not running. */
export const agentHeartbeatMilliseconds = 5000;
export const agentStaleAfterMilliseconds = 30_000;

/** The agent serving a lane folder, in `agent.json`; its modification time is the agent's heartbeat. */
export const AgentDocumentSchema = z.strictObject({
  host: z.string().min(1),
  user: z.string().min(1),
  processId: z.number().int().positive(),
  startedUtc: z.string(),
  token: z.string().min(1),
});
export type AgentDocument = z.infer<typeof AgentDocumentSchema>;

/** A command the workflow sends to a lane agent. */
export const LaneRequestSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
  label: z.string(),
  command: z.string().min(1),
  args: z.array(z.string()),
  cwd: z.string().min(1),
  desktop: z.boolean(),
});
export type LaneRequest = z.infer<typeof LaneRequestSchema>;

/** How a request ended, written once its output is complete. */
export const LaneExitSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("exited"), status: z.number().int() }),
  z.strictObject({ kind: z.literal("signal"), signal: z.string() }),
  z.strictObject({ kind: z.literal("failed"), message: z.string() }),
  z.strictObject({ kind: z.literal("stopped") }),
]);
export type LaneExit = z.infer<typeof LaneExitSchema>;

export function agentFile(folder: string): string {
  return join(folder, "agent.json");
}

export function requestsFolder(folder: string): string {
  return join(folder, "requests");
}

/** The files of one request in a lane folder. */
export function requestFiles(folder: string, id: string) {
  const base = join(requestsFolder(folder), id);
  return { request: `${base}.json`, log: `${base}.log`, exit: `${base}.exit.json`, cancel: `${base}.cancel` } as const;
}

/** The request ID a file of the requests folder names, or null for the other files there. */
export function requestIdOf(fileName: string): string | null {
  const match = /^([A-Za-z0-9-]{1,80})\.json$/.exec(fileName);
  return match === null || fileName.endsWith(".exit.json") ? null : match[1]!;
}

export function newRequestId(now: Date): string {
  return `${now.toISOString().replace(/[-:.TZ]/g, "")}-${randomUUID()}`;
}

/** Writes the file under a temporary name and renames it into place, so a reader never sees half of it. */
export async function writeAtomically(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, text);
  await rename(temporary, path);
}

/** The agent of a folder with the time it last refreshed its file, "absent" when there is none, or "unreadable". */
export async function readAgent(folder: string): Promise<{ readonly document: AgentDocument; readonly refreshedMilliseconds: number } | "absent" | "unreadable"> {
  let text: string;
  let refreshedMilliseconds: number;
  try {
    text = await readFile(agentFile(folder), "utf8");
    refreshedMilliseconds = (await stat(agentFile(folder))).mtimeMs;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "absent";
    return "unreadable";
  }
  try {
    const parsed = AgentDocumentSchema.safeParse(JSON.parse(text));
    return parsed.success ? { document: parsed.data, refreshedMilliseconds } : "unreadable";
  } catch {
    return "unreadable";
  }
}

/** A request's exit, or null while it has none. */
export async function readExit(path: string): Promise<LaneExit | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return LaneExitSchema.parse(JSON.parse(text));
}
