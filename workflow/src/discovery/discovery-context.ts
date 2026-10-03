import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { captureNames, type PlannedCase } from "../cases/case-plan.js";
import { canonicalJson } from "../diagnosis/context.js";
import type { SourceSnapshot } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { sha256File, sha256Text } from "../steps/fingerprint.js";
import { feasibilities } from "./job-schemas.js";
import { selectedTabNames } from "./plan-validator.js";
import type { RankedPrior } from "./priors.js";
import { formOfMode, TargetSchema } from "./targets.js";

const action = z.strictObject({
  type: z.string(), name: z.string().optional(), label: z.string().optional(), milliseconds: z.number().optional(), optional: z.boolean().optional(),
});

const FixtureSchema = z.strictObject({
  case: z.string().min(1),
  mode: z.enum(["build", "career"]),
  /** The form class the character opens in. */
  form: z.string().min(1),
  file: z.string().min(1),
  /** The tab names its actions select, in order, each once. */
  selectedTabs: z.array(z.string()),
  captures: z.array(z.string()),
  /** The copy of its character file in the context folder (`fixtures/<file>`), with its SHA-256 so the context hash covers it. */
  copy: z.strictObject({ path: z.string().min(1), sha256: z.string() }),
  /** Its expanded actions; only a scenario context has them. */
  actions: z.array(action).optional(),
});
export type ContextFixture = z.infer<typeof FixtureSchema>;

const SourceSchema = z.strictObject({
  /** The snapshot folder, relative to the context folder. */
  folder: z.string(), identity: z.string(), commit: z.string(), candidate: z.string(),
});

const common = {
  schemaVersion: z.literal(1),
  baselineThread: z.string().min(1),
  /** The source inventory's hash. */
  sourceSha256: z.string(),
  /** The tab texts a `selectTab` may name, by form class. */
  tabTexts: z.record(z.string(), z.array(z.string())),
  source: SourceSchema,
};

/** The sealed context of the rank job: every target, the fixtures and the priors. */
export const RankContextSchema = z.strictObject({
  ...common,
  kind: z.literal("rank"),
  targets: z.array(TargetSchema).min(1),
  fixtures: z.array(FixtureSchema).min(1),
  priors: z.array(z.strictObject({
    /** The archived change's folder name; its files are in `priors/<name>/`. */
    name: z.string(), score: z.number(), target: z.string(), reasons: z.array(z.string()),
    cluster: z.string(), claim: z.string(), mechanism: z.string(), files: z.array(z.string()),
    artifacts: z.array(z.strictObject({ path: z.string(), sha256: z.string() })),
  })).min(1).optional(),
});
export type RankContext = z.infer<typeof RankContextSchema>;

/** The sealed context of one scenario job: its target, its rank, the fixtures with their actions and the known labels. */
export const ScenarioContextSchema = z.strictObject({
  ...common,
  kind: z.literal("scenario"),
  target: TargetSchema,
  rank: z.strictObject({ score: z.number(), feasibility: z.enum(feasibilities), case: z.string().nullable(), reason: z.string() }),
  fixtures: z.array(FixtureSchema).min(1),
  /** `labels.json` in the context folder: every text a `waitFor` may name, with its SHA-256 so the context hash covers it. */
  labels: z.strictObject({ path: z.literal("labels.json"), sha256: z.string(), count: z.number().int().nonnegative() }),
});
export type ScenarioContext = z.infer<typeof ScenarioContextSchema>;

export type DiscoveryContext = RankContext | ScenarioContext;

/** A sealed context of either job kind. */
export const DiscoveryContextSchema = z.discriminatedUnion("kind", [RankContextSchema, ScenarioContextSchema]);

export function discoveryContextHash(context: DiscoveryContext): string {
  return sha256Text(canonicalJson(context));
}

/** The labels of a scenario context folder; a labels file that differs from the hash its context records is a setup error. */
export function readLabels(folder: string, context: Pick<ScenarioContext, "labels">): string[] {
  const path = join(folder, context.labels.path);
  if (!existsSync(path)) throw new SetupError(`The labels file ${path} of a sealed context is missing.`);
  const bytes = readFileSync(path);
  if (createHash("sha256").update(bytes).digest("hex") !== context.labels.sha256) throw new SetupError(`The labels file ${path} changed after its context was sealed.`);
  return z.array(z.string()).parse(JSON.parse(bytes.toString("utf8")));
}

/** The fixture cases as a context shows them, each character file copied into `fixtures/`; with `actions` their expanded actions too. */
async function sealFixtures(cases: readonly PlannedCase[], withActions: boolean, folder: string): Promise<ContextFixture[]> {
  mkdirSync(join(folder, "fixtures"), { recursive: true });
  const fixtures: ContextFixture[] = [];
  for (const item of cases) {
    const path = `fixtures/${item.characterFile}`;
    if (!existsSync(join(folder, path))) copyFileSync(item.fixturePath, join(folder, path));
    fixtures.push({
      case: item.name, mode: item.mode, form: formOfMode[item.mode], file: item.characterFile, selectedTabs: selectedTabNames(item.actions), captures: captureNames(item),
      copy: { path, sha256: await sha256File(join(folder, path)) }, ...(withActions ? { actions: item.actions.map((entry) => ({ ...entry })) } : {}),
    });
  }
  return fixtures;
}

/** The form a fixture case opens in. */
export function formOfCase(item: Pick<PlannedCase, "mode">): string {
  return formOfMode[item.mode];
}

function fileSha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Fails unless every file a sealed context lists (fixture copies, prior artifacts, the labels file) has the SHA-256 it records. */
export function verifyContextFiles(folder: string, context: DiscoveryContext): void {
  const files = [
    ...context.fixtures.map((fixture) => fixture.copy), ...(context.kind === "rank" ? (context.priors ?? []).flatMap((prior) => prior.artifacts) : [context.labels]),
  ];
  for (const file of files) {
    const path = join(folder, file.path);
    if (!existsSync(path) || fileSha256(path) !== file.sha256) throw new SetupError(`The file ${path} of a sealed context is missing or changed after it was sealed.`);
  }
}

export function contextSource(snapshot: SourceSnapshot, candidate: string): RankContext["source"] {
  return { folder: "../source", identity: snapshot.identity, commit: snapshot.commit, candidate };
}

/** The files of an archived fix change a prior carries into the context. */
const priorFiles = ["proposal.md", "tasks.md", "verification.md", "fix.json"] as const;

async function sealPriors(priors: readonly RankedPrior[], folder: string): Promise<RankContext["priors"]> {
  if (priors.length === 0) return undefined;
  const sealed: NonNullable<RankContext["priors"]> = [];
  for (const prior of priors) {
    const artifacts: { path: string; sha256: string }[] = [];
    for (const file of priorFiles) {
      const source = join(prior.folder, file);
      if (!existsSync(source)) throw new SetupError(`The archived fix change ${prior.folder} has no ${file}.`);
      const path = `priors/${prior.name}/${file}`;
      mkdirSync(join(folder, "priors", prior.name), { recursive: true });
      copyFileSync(source, join(folder, path));
      artifacts.push({ path, sha256: await sha256File(join(folder, path)) });
    }
    const { record } = prior;
    sealed.push({
      name: prior.name, score: prior.score, target: prior.target, reasons: [...prior.reasons], cluster: record.cluster.id, claim: record.hypothesis.claim,
      mechanism: record.hypothesis.mechanism, files: record.patch.files.map((file) => file.path), artifacts,
    });
  }
  return sealed;
}

export type RankContextInput = Omit<RankContext, "schemaVersion" | "kind" | "priors" | "fixtures"> & { readonly priors: readonly RankedPrior[]; readonly fixtures: readonly PlannedCase[] };

/** Writes the rank job's context folder (`context.json` and `priors/`) and returns its manifest and hash. */
export async function sealRankContext(input: RankContextInput, folder: string): Promise<{ context: RankContext; hash: string }> {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const { priors, fixtures, ...rest } = input;
  const sealedPriors = await sealPriors(priors, folder);
  const context = RankContextSchema.parse({
    schemaVersion: 1, kind: "rank", ...rest, fixtures: await sealFixtures(fixtures, false, folder), ...(sealedPriors === undefined ? {} : { priors: sealedPriors }),
  });
  writeFileSync(join(folder, "context.json"), `${JSON.stringify(context, null, 2)}\n`);
  return { context, hash: discoveryContextHash(context) };
}

export type ScenarioContextInput = Omit<ScenarioContext, "schemaVersion" | "kind" | "labels" | "fixtures"> & { readonly labels: readonly string[]; readonly fixtures: readonly PlannedCase[] };

/** Writes a scenario job's context folder (`context.json` and `labels.json`) and returns its manifest and hash. */
export async function sealScenarioContext(input: ScenarioContextInput, folder: string): Promise<{ context: ScenarioContext; hash: string }> {
  rmSync(folder, { recursive: true, force: true });
  mkdirSync(folder, { recursive: true });
  const { labels, fixtures, ...rest } = input;
  writeFileSync(join(folder, "labels.json"), `${JSON.stringify(labels, null, 2)}\n`);
  const context = ScenarioContextSchema.parse({
    schemaVersion: 1, kind: "scenario", ...rest, fixtures: await sealFixtures(fixtures, true, folder), labels: { path: "labels.json", sha256: await sha256File(join(folder, "labels.json")), count: labels.length },
  });
  writeFileSync(join(folder, "context.json"), `${JSON.stringify(context, null, 2)}\n`);
  return { context, hash: discoveryContextHash(context) };
}
