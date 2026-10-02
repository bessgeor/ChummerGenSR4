import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { CompareReport } from "../../../contracts/generated/typescript/parity-compare-report.js";
import type { PlannedCase } from "../cases/case-plan.js";
import { captureNames } from "../cases/case-plan.js";
import { SetupError } from "../host/setup-error.js";
import { sha256File, sha256Text } from "../steps/fingerprint.js";
import type { TriageDocument } from "../triage/triage-document.js";
import { rankFixes, type ArchivedFix } from "../fixes/retrieval.js";
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
  /** Archived fixes that resemble the cluster, best first; absent when the thread works without fix changes or none resembles it. */
  priors: z.array(z.strictObject({
    /** The archived change's folder name; its files are in `priors/<name>/`. */
    name: z.string(), score: z.number(), reasons: z.array(z.string()),
    cluster: z.string(), claim: z.string(), mechanism: z.string(), files: z.array(z.string()),
    /** Paths relative to the context folder, with their SHA-256, so the context hash covers them. */
    artifacts: z.array(z.strictObject({ path: z.string(), sha256: z.string() })),
  })).min(1).optional(),
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
  /** The repository's archived fix changes to rank as priors, or null when the thread works without fix changes. */
  readonly fixes?: readonly ArchivedFix[] | null;
};

/** The files of an archived fix change a prior carries into the context. */
const priorFiles = ["proposal.md", "tasks.md", "verification.md", "fix.json"] as const;

/** Ranks the archived fixes against the sealed members and copies the best into `priors/`; nothing when none resembles the cluster. */
async function sealPriors(fixes: readonly ArchivedFix[], cluster: ContextManifest["cluster"], members: ContextManifest["members"], folder: string): Promise<ContextManifest["priors"]> {
  const ranked = rankFixes({
    imageHash: cluster.imageHash, cases: cluster.cases, captures: cluster.captures,
    ocr: members.flatMap((member) => [member.canonicalOcr.text, member.candidateOcr.text]),
  }, fixes);
  if (ranked.length === 0) return undefined;
  const priors: NonNullable<ContextManifest["priors"]> = [];
  for (const fix of ranked) {
    const artifacts: { path: string; sha256: string }[] = [];
    for (const file of priorFiles) {
      const source = join(fix.folder, file);
      if (!existsSync(source)) throw new SetupError(`The archived fix change ${fix.folder} has no ${file}.`);
      const path = `priors/${fix.name}/${file}`;
      mkdirSync(join(folder, "priors", fix.name), { recursive: true });
      copyFileSync(source, join(folder, path));
      artifacts.push({ path, sha256: await sha256File(join(folder, path)) });
    }
    const { record } = fix;
    priors.push({
      name: fix.name, score: fix.score, reasons: [...fix.reasons], cluster: record.cluster.id, claim: record.hypothesis.claim, mechanism: record.hypothesis.mechanism,
      files: record.patch.files.map((file) => file.path), artifacts,
    });
  }
  return priors;
}

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
  // A folder sealed before holds its priors; the manifest lists only the ones ranked now.
  rmSync(join(folder, "priors"), { recursive: true, force: true });
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
  const sealedCluster = { id: cluster.id, imageHash: cluster.imageHash, known: cluster.known, cases: cluster.cases, captures: cluster.captures, members: cluster.members.length };
  const priors = input.fixes === null || input.fixes === undefined ? undefined : await sealPriors(input.fixes, sealedCluster, members, folder);
  const manifest = ContextManifestSchema.parse({
    schemaVersion: 1,
    cluster: sealedCluster,
    members,
    scenarios,
    vocabulary: input.cases.map((item) => ({ case: item.name, mode: item.mode, captures: captureNames(item) })),
    source: { folder: "../source", identity: input.snapshot.identity, commit: input.snapshot.commit, candidate: input.candidate },
    ...(priors === undefined ? {} : { priors }),
  });
  writeFileSync(join(folder, "context.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return { folder, hash: contextHash(manifest), manifest };
}
