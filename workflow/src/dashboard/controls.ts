import { existsSync } from "node:fs";
import { z } from "zod";
import { HttpError } from "../review/http-error.js";
import { loopFiles, LoopControlSchema, LoopDocumentSchema, LoopStateSchema, readJson, writeControl, type LoopControl } from "./loop-documents.js";
import type { ControlRequest } from "./snapshot.js";

export const ControlRequestSchema = z.strictObject({
  loop: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, "a loop ID is letters, digits, dots, underscores and hyphens"),
  lane: z.string().min(1).nullable(),
  paused: z.boolean(),
});

/**
 * Pauses or resumes the loop (lane null) or one of its lanes by writing its control file, keeping every other flag.
 * An unknown or ended loop, or a lane the loop does not have, is refused and nothing is written.
 */
export function applyControl(loopRoot: string, request: ControlRequest, now: Date): LoopControl {
  const files = loopFiles(loopRoot, request.loop);
  if (!existsSync(files.loop)) throw new HttpError(404, `There is no loop ${request.loop}.`);
  const document = readJson(files.loop, LoopDocumentSchema);
  if (document.endedUtc !== null) throw new HttpError(409, `Loop ${request.loop} ended at ${document.endedUtc}; there is nothing to pause or resume.`);
  const state = existsSync(files.state) ? readJson(files.state, LoopStateSchema) : null;
  const current: LoopControl = existsSync(files.control) ? readJson(files.control, LoopControlSchema) : { paused: state?.paused ?? false, lanes: {}, updatedUtc: now.toISOString() };
  if (request.lane !== null) {
    const known = new Set([...Object.keys(state?.lanes ?? {}), ...Object.keys(current.lanes)]);
    if (!known.has(request.lane)) throw new HttpError(404, `Loop ${request.loop} has no lane ${request.lane}; its lanes are ${[...known].sort().join(", ") || "not known yet"}.`);
  }
  const next: LoopControl = request.lane === null
    ? { ...current, paused: request.paused, updatedUtc: now.toISOString() }
    : { ...current, lanes: { ...current.lanes, [request.lane]: { paused: request.paused } }, updatedUtc: now.toISOString() };
  writeControl(files.control, next);
  return next;
}
