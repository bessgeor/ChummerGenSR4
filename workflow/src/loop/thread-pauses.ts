import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readDocument } from "../steps/read-document.js";
import { writeDocument } from "../steps/write-document.js";
import type { Pause } from "./loop-control.js";

/** `pauses.json` in a thread's folder: the pauses of a thread a loop ran, which its elapsed time leaves out. */
const ThreadPausesSchema = z.strictObject({
  pauses: z.array(z.strictObject({ startedUtc: z.iso.datetime(), endedUtc: z.iso.datetime(), milliseconds: z.number().int().nonnegative() })),
});

function pausesPath(threadFolder: string): string {
  return join(threadFolder, "pauses.json");
}

function readPauses(threadFolder: string): Pause[] {
  const path = pausesPath(threadFolder);
  return existsSync(path) ? readDocument(path, ThreadPausesSchema).pauses : [];
}

/** Adds a pause of the thread to its `pauses.json`. */
export function recordThreadPause(threadFolder: string, pause: Pause): void {
  writeDocument(pausesPath(threadFolder), ThreadPausesSchema.parse({ pauses: [...readPauses(threadFolder), pause] }));
}

/** How long the thread was paused; 0 for a thread that never was. */
export function threadPausedMilliseconds(threadFolder: string): number {
  return readPauses(threadFolder).reduce((sum, pause) => sum + pause.milliseconds, 0);
}
