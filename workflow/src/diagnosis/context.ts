import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import type { PlannedCase } from "../cases/case-plan.js";
import { captureNames } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import { sha256File, sha256Text } from "../steps/fingerprint.js";
import type { TriageDocument } from "../triage/triage-document.js";
import type { SourceSnapshot } from "./source-snapshot.js";

/** At most this many members of a cluster go into its context; the manifest says how many there are. */
export const maximumMembers = 5;

const rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });
const ocr = z.strictObject({ status: z.string(), text: z.string().nullable() });
const action = z.strictObject({
  type: z.string(), name: z.string().optional(), label: z.string().optional(), milliseconds: z.number().optional(), optional: z.boolean().optional(),
});

/** The sealed context of one cluster: everything a job about it may know, from recorded files only. */
export const ContextManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  cluster: z.strictObject({
    id: z.string(), imageHash: z.string(), known: z.boolean(), cases: z.array(z.string()), captures: z.array(z.string()), members: z.number().int(),
  }),
  members: z.array(z.strictObject({
    case: z.string(), capture: z.string(), discrepancy: z.string(), core: rect, crop: rect, differingPixels: z.number(),
    /** Paths relative to the context folder. */
    canonicalCrop: z.string(), canonicalCropSha256: z.string(), candidateCrop: z.string(), candidateCropSha256: z.string(),
    canonicalOcr: ocr, candidateOcr: ocr,
  })).min(1),
  scenarios: z.array(z.strictObject({
    case: z.string(), mode: z.enum(["build", "career"]), fixture: z.strictObject({ file: z.string(), sha256: z.string() }),
    capture: z.string(),
    /** The expanded actions up to and including the capture. */
    actions: z.array(action),
  })),
  /** The cases and captures a check may name. */
  vocabulary: z.array(z.strictObject({ case: z.string(), mode: z.enum(["build", "career"]), captures: z.array(z.string()) })),
  source: z.strictObject({
    /** The snapshot folder, relative to the context folder. */
    folder: z.string(), identity: z.string(), commit: z.string(), candidate: z.string(),
  }),
});
export type ContextManifest = z.infer<typeof ContextManifestSchema>;

export type SealedContext = { readonly folder: string; readonly hash: string; readonly manifest: ContextManifest };

/** JSON with object keys sorted at every level, so equal values always give equal text. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function contextHash(manifest: ContextManifest): string {
  return sha256Text(canonicalJson(manifest));
}

export type ContextInput = {
  readonly triage: TriageDocument;
  readonly clusterId: string;
  /** Every case of the thread's case file: the check vocabulary and the scenarios. */
  readonly cases: readonly PlannedCase[];
  readonly readReport: (runFolder: string) => CompareReport;
  readonly snapshot: SourceSnapshot;
  /** The fingerprint of the candidate app the thread captured. */
  readonly candidate: string;
};

function copyCrop(source: string, folder: string, name: string): string {
  if (!existsSync(source)) throw new SetupError(`The crop ${source} that the diagnosis context needs does not exist.`);
  mkdirSync(join(folder, "evidence"), { recursive: true });
  copyFileSync(source, join(folder, "evidence", name));
  return `evidence/${name}`;
}

/** Writes a cluster's context folder (`context.json` and `evidence/`) and returns its manifest and hash. */
export async function sealContext(input: ContextInput, folder: string): Promise<SealedContext> {
  const cluster = input.triage.clusters.find((item) => item.id === input.clusterId);
  if (cluster === undefined) throw new SetupError(`Triage has no cluster ${input.clusterId}.`);
  const plannedCase = (name: string) => {
    const found = input.cases.find((item) => item.name === name);
    if (found === undefined) throw new SetupError(`Cluster ${cluster.id} names case ${name}, which the case file does not have.`);
    return found;
  };
  const members: ContextManifest["members"] = [];
  const scenarios: ContextManifest["scenarios"] = [];
  for (const [index, member] of cluster.members.slice(0, maximumMembers).entries()) {
    const runFolder = input.triage.cases.find((item) => item.case === member.case)?.runFolder;
    if (runFolder === undefined) throw new SetupError(`Triage has no run folder for case ${member.case}.`);
    const discrepancy = input.readReport(runFolder).discrepancies.find((item) => item.id === member.discrepancy);
    if (discrepancy === undefined) throw new SetupError(`The report in ${runFolder} has no discrepancy ${member.discrepancy}.`);
    const canonicalCrop = copyCrop(member.canonicalCrop, folder, `${index + 1}-canonical.png`);
    const candidateCrop = copyCrop(member.candidateCrop, folder, `${index + 1}-candidate.png`);
    members.push({
      case: member.case, capture: member.capture, discrepancy: member.discrepancy, core: member.core, crop: member.crop,
      differingPixels: member.differingPixels,
      canonicalCrop, canonicalCropSha256: await sha256File(join(folder, canonicalCrop)),
      candidateCrop, candidateCropSha256: await sha256File(join(folder, candidateCrop)),
      canonicalOcr: { status: discrepancy.canonicalOcr.status, text: discrepancy.canonicalOcr.text ?? null },
      candidateOcr: { status: discrepancy.candidateOcr.status, text: discrepancy.candidateOcr.text ?? null },
    });
    if (!scenarios.some((item) => item.case === member.case && item.capture === member.capture)) {
      const item = plannedCase(member.case);
      const end = item.actions.findIndex((entry) => entry.type === "capture" && entry.name === member.capture);
      if (end < 0) throw new SetupError(`Case ${item.name} has no capture ${member.capture}.`);
      scenarios.push({
        case: item.name, mode: item.mode, fixture: { file: item.characterFile, sha256: await sha256File(item.fixturePath) },
        capture: member.capture, actions: item.actions.slice(0, end + 1).map((entry) => ({ ...entry })),
      });
    }
  }
  const manifest = ContextManifestSchema.parse({
    schemaVersion: 1,
    cluster: { id: cluster.id, imageHash: cluster.imageHash, known: cluster.known, cases: cluster.cases, captures: cluster.captures, members: cluster.members.length },
    members,
    scenarios,
    vocabulary: input.cases.map((item) => ({ case: item.name, mode: item.mode, captures: captureNames(item) })),
    source: { folder: "../source", identity: input.snapshot.identity, commit: input.snapshot.commit, candidate: input.candidate },
  });
  writeFileSync(join(folder, "context.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { folder, hash: contextHash(manifest), manifest };
}
