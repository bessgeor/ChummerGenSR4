import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { graphKinds } from "./snapshot.js";

/** The loop's folder, `out/loop/<loop>/`, and its documents. */
export function loopFiles(loopRoot: string, loopId: string) {
  const folder = join(loopRoot, loopId);
  return {
    folder, loop: join(folder, "loop.json"), control: join(folder, "control.json"),
    state: join(folder, "state.json"), activity: join(folder, "activity.jsonl"),
  };
}

export const LoopControlSchema = z.object({
  paused: z.boolean(),
  lanes: z.record(z.string(), z.object({ paused: z.boolean() })),
  updatedUtc: z.string(),
});
export type LoopControl = z.infer<typeof LoopControlSchema>;

const BusySchema = z.object({ thread: z.string(), node: z.string(), subject: z.string().nullable() });

export const LoopStateSchema = z.object({
  paused: z.boolean(),
  pausing: z.boolean(),
  lanes: z.record(z.string(), z.object({ paused: z.boolean(), busy: BusySchema.nullable() })),
  updatedUtc: z.string(),
});
export type LoopState = z.infer<typeof LoopStateSchema>;

export const ActivityLineSchema = z.object({
  thread: z.string(),
  graph: z.enum(graphKinds),
  node: z.string(),
  subject: z.string().nullable(),
  lane: z.string().nullable(),
  startedUtc: z.string(),
  finishedUtc: z.string(),
  pausedMs: z.number().nonnegative(),
  status: z.string(),
});
export type ActivityLine = z.infer<typeof ActivityLineSchema>;

export const LoopDocumentSchema = z.object({
  loopId: z.string(),
  startedUtc: z.string(),
  endedUtc: z.string().nullable(),
  threads: z.array(z.object({
    thread: z.string(), graph: z.enum(graphKinds), startedUtc: z.string(), endedUtc: z.string().nullable(), reason: z.string().nullable(),
  })),
});
export type LoopDocument = z.infer<typeof LoopDocumentSchema>;

/** A JSON document checked against its schema; the error names the file. */
export function readJson<T>(path: string, schema: z.ZodType<T>): T {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${path} cannot be read: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error(`${path} does not match its schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

/** The activity log's lines; a line that does not parse is an error naming its line number. */
export function readActivity(path: string): ActivityLine[] {
  const text = readFileSync(path, "utf8");
  return text.split(/\r?\n/).flatMap((line, index) => {
    if (line.trim().length === 0) return [];
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (error) {
      throw new Error(`${path} line ${index + 1} is not JSON: ${(error as Error).message}`);
    }
    const parsed = ActivityLineSchema.safeParse(value);
    if (!parsed.success) throw new Error(`${path} line ${index + 1} does not match its schema: ${z.prettifyError(parsed.error)}`);
    return [parsed.data];
  });
}

/** Writes the control file through a temporary file renamed into place, so the loop never reads half a file. */
export function writeControl(path: string, control: LoopControl): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(LoopControlSchema.parse(control), null, 2)}\n`);
  renameSync(temporary, path);
}
