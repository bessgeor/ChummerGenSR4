import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { EvaluatedJobKind } from "../evals/evaluated-job-kinds.js";
import { SetupError } from "../host/setup-error.js";
import { readDocument } from "../steps/read-document.js";
import { tuningId, TuningSchema, type Tuning } from "./tuning.js";

/** A configuration under evaluation: written by a person (`added`) or by a `tune` job (`proposed`) from a development run. */
export const CandidateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^tuned-[0-9a-f]{12}$/),
  tuning: TuningSchema,
  origin: z.enum(["added", "proposed"]),
  /** The `tune` job's record of a proposed candidate. */
  record: z.string().nullable(),
  /** The development run a proposed candidate was proposed from, and its dataset's hash. */
  fromRun: z.string().nullable(),
  datasetHash: z.string().nullable(),
  rationale: z.string().nullable(),
  createdUtc: z.string(),
}).refine((candidate) => candidate.id === tuningId(candidate.tuning), "the candidate's ID is not its configuration's ID");
export type Candidate = z.infer<typeof CandidateSchema>;

/** `out/evals/tuning/candidates/`. */
export function candidatesFolder(evalsFolder: string): string {
  return join(evalsFolder, "tuning", "candidates");
}

/** A stored candidate; an unknown ID or an invalid file is a setup error. */
export function readCandidate(folder: string, id: string): Candidate {
  const path = join(folder, `${id}.json`);
  if (!/^tuned-[0-9a-f]{12}$/.test(id) || !existsSync(path)) throw new SetupError(`There is no tuning candidate ${id} in ${folder}.`);
  return readDocument(path, CandidateSchema);
}

/** Every stored candidate of a job kind, oldest first. */
export function listCandidates(folder: string, jobKind: EvaluatedJobKind): Candidate[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter((name) => name.endsWith(".json")).map((name) => readCandidate(folder, name.slice(0, -".json".length)))
    .filter((candidate) => candidate.tuning.jobKind === jobKind).sort((left, right) => left.createdUtc.localeCompare(right.createdUtc) || left.id.localeCompare(right.id));
}

/** Stores a candidate unless one with the same configuration exists, which is kept: equal configurations are one candidate. */
export function storeCandidate(folder: string, candidate: Omit<Candidate, "id" | "schemaVersion">): { candidate: Candidate; existed: boolean } {
  const id = tuningId(candidate.tuning);
  if (existsSync(join(folder, `${id}.json`))) return { candidate: readCandidate(folder, id), existed: true };
  const stored = CandidateSchema.parse({ schemaVersion: 1, id, ...candidate });
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, `${id}.json`), `${JSON.stringify(stored, null, 2)}\n`);
  return { candidate: stored, existed: false };
}

/** Parses a person's candidate file: a configuration and nothing else. */
export function parseTuningFile(path: string): Tuning {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`The tuning file ${path} cannot be read: ${(error as Error).message}`);
  }
  const parsed = TuningSchema.safeParse(document);
  if (!parsed.success) throw new SetupError(`The tuning file ${path} is not a valid configuration: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
