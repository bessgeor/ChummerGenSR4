import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { z } from "zod";
import { caseName, planCases, type PlannedCase } from "../cases/case-plan.js";
import { recordedCandidateSha256, recordedCandidateSource, requireRecordedSource, requireSameSource } from "../diagnosis/candidate-source.js";
import { compiledSourceIdentity, compiledSourcePaths, createSourceSnapshot, type Git } from "../diagnosis/source-snapshot.js";
import { fixArchiveOf, fixesRootOf } from "../fixes/fix-archiver.js";
import { readArchivedFixes } from "../fixes/retrieval.js";
import { SetupError } from "../host/setup-error.js";
import { CoverageManifestSchema, type CoverageManifest } from "../inventory/coverage-manifest-document.js";
import { defaultScopeFile } from "../inventory/inventory-service.js";
import { readScope, type Scope } from "../inventory/scope.js";
import { SourceInventorySchema, type SourceInventory } from "../inventory/source-inventory-document.js";
import { buildSourceInventory, designerPaths } from "../inventory/source-inventory.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { sha256FileSync, sha256Text } from "../steps/fingerprint.js";
import { readDocument } from "../steps/read-document.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import {
  contextSource, discoveryContextHash, formOfCase, RankContextSchema, readLabels, ScenarioContextSchema, sealRankContext, sealScenarioContext, verifyContextFiles,
  type RankContext, type ScenarioContext,
} from "./discovery-context.js";
import type { DiscoveryJobs, JobInput } from "./discovery-jobs.js";
import type { DiscoveryPaths } from "./discovery-paths.js";
import { pendingJob, type Coverage, type DiscoveryOptions, type DiscoveryStateValue, type JobState, type Prepared, type ScenarioJob, type ScenarioUpdate } from "./discovery-state.js";
import { dispatchedTuningOf, tunedPromptVersion } from "../tuning/tuning.js";
import { RankOutputSchema, rankPromptVersion, ScenarioOutputSchema, scenarioPromptVersion, type RankOutput, type ScenarioOutput } from "./job-schemas.js";
import { knownLabels, knownTabTexts, readLanguageStrings } from "./known-texts.js";
import { scenarioActions, validatePlan } from "./plan-validator.js";
import { classFiles, rankPriors } from "./priors.js";
import { rankPrompt, scenarioPrompt } from "./prompts.js";
import { provedFor, readRegistry, type RegistryPaths } from "./registry.js";
import { scenarioName } from "./scenario-cases.js";
import { computeTargets, TargetsDocumentSchema, type TargetsDocument } from "./targets.js";
import { selectableRankings, validateRank, validateScenario } from "./validation.js";

export type DiscoveryDependencies = {
  readonly repositoryRoot: string;
  readonly paths: WorkflowPaths;
  readonly folders: DiscoveryPaths;
  /** The scenario registry and its case file. */
  readonly registry: RegistryPaths;
  readonly git: Git;
  readonly jobs: DiscoveryJobs;
  /** Builds the capture tools, not the candidate, and fingerprints the thread's inputs. */
  readonly buildTools: (options: RunOptions, signal?: AbortSignal) => Promise<InputFingerprints>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** A discovery thread's options as the capture tools take them: no filters, no model work of the workflow's. */
export function captureOptions(options: DiscoveryOptions, caseFile = options.caseFile): RunOptions {
  return {
    caseFile, cases: [], captures: [], settingsOverlay: options.settingsOverlay, threshold: options.threshold, canonicalCache: options.canonicalCache,
    canonicalCacheSource: options.canonicalCacheSource, noOcr: true, tessdata: null, only: null, recapture: false, diagnosis: false, agents: options.agents,
    unattended: options.unattended, certificates: options.certificates, repair: null, widening: false, fixChanges: false,
  };
}

/** The baseline's documents as `prepare` checked them. */
export type Baseline = { readonly inventory: SourceInventory; readonly manifest: CoverageManifest; readonly scope: Scope };

/** The SHA-256 of the baseline's two documents, which every later read must find unchanged. */
export type BaselineDigest = { readonly inventory: string; readonly manifest: string };

/**
 * Reads the baseline's documents and the scope. With a digest, documents that changed since `prepare` checked them, or a scope that
 * differs from the manifest's, are a setup error: targets, contexts and proofs must all be measured against the same baseline.
 */
export function readBaseline(folder: string, repositoryRoot: string, digest?: BaselineDigest): Baseline & { readonly digest: BaselineDigest } {
  for (const file of ["source-inventory.json", "coverage-manifest.json"]) {
    if (!existsSync(join(folder, file))) throw new SetupError(`The baseline has no ${file}: ${join(folder, file)} is missing; run npm start, whose inventory writes it.`);
  }
  const found = { inventory: sha256FileSync(join(folder, "source-inventory.json")), manifest: sha256FileSync(join(folder, "coverage-manifest.json")) };
  if (digest !== undefined && (found.inventory !== digest.inventory || found.manifest !== digest.manifest)) {
    throw new SetupError(`The baseline documents in ${folder} changed since the thread started; start a new thread.`);
  }
  const baseline = {
    inventory: readDocument(join(folder, "source-inventory.json"), SourceInventorySchema),
    manifest: readDocument(join(folder, "coverage-manifest.json"), CoverageManifestSchema),
    scope: readScope(join(repositoryRoot, defaultScopeFile)),
  };
  if (digest !== undefined && baseline.scope.sha256 !== baseline.manifest.scope.sha256) throw new SetupError(`${defaultScopeFile} changed since the baseline; start a new thread.`);
  return { ...baseline, digest: found };
}

function coverageOf(manifest: CoverageManifest): Coverage {
  const { controls, interactions } = manifest.totals;
  return { controls: { active: controls.active, observed: controls.observed }, interactions: { active: interactions.active, exercised: interactions.exercised } };
}

/** The fixture cases of a thread; a case file that changed since the thread started is a setup error, since its sealed contexts describe the old one. */
export function fixtureCases(caseFile: string, expectedSha256: string): readonly PlannedCase[] {
  if (sha256Text(readFileSync(caseFile, "utf8")) !== expectedSha256) throw new SetupError(`The case file ${caseFile} changed since the thread started; start a new thread.`);
  return planCases(caseFile, [], []).cases;
}

/** The tab texts of every form the fixtures open in. */
function tabTexts(cases: readonly PlannedCase[], baseline: Baseline, root: string): Record<string, string[]> {
  const strings = readLanguageStrings(root);
  const forms = [...new Set(cases.map((item) => formOfCase(item)))].sort();
  return Object.fromEntries(forms.map((form) => [form, knownTabTexts(form, baseline.inventory, baseline.manifest, strings)]));
}

/** Discovery on the real host: the baseline and its guards, targets, contexts, the jobs and validation. */
export class DiscoveryService {
  constructor(private readonly dependencies: DiscoveryDependencies) {}

  /** Checks the baseline against the working tree and the candidate, builds the tools, writes the targets and seals the rank context. */
  async prepare(threadId: string, options: DiscoveryOptions, signal?: AbortSignal): Promise<Prepared> {
    const { repositoryRoot: root, git, paths, log } = this.dependencies;
    if (resolve(options.caseFile).toLowerCase() === resolve(this.dependencies.registry.caseFile).toLowerCase()) {
      throw new SetupError(`${options.caseFile} is the registry's own case file, which discovery rewrites; name the fixture case file with --case-file.`);
    }
    const folders = this.dependencies.folders.thread(threadId);
    mkdirSync(folders.root, { recursive: true });
    const baselineFolder = join(paths.threadFolder(options.from), "inventory");
    const baseline = readBaseline(baselineFolder, root);
    const { manifest } = baseline;
    if (manifest.runs.length === 0) throw new SetupError(`The baseline ${baselineFolder} read no capture run, so it observed nothing.`);
    const current = buildSourceInventory(root, designerPaths(compiledSourcePaths(root, git)));
    if (current.sourceSha256 !== manifest.sourceSha256 || baseline.inventory.sourceSha256 !== manifest.sourceSha256) {
      throw new SetupError(`The designer and code files differ from the baseline's (source hash now ${current.sourceSha256.slice(0, 12)}, baseline ${manifest.sourceSha256.slice(0, 12)}); run npm start again.`);
    }
    if (baseline.scope.sha256 !== manifest.scope.sha256) throw new SetupError(`${defaultScopeFile} changed since the baseline; run npm start again.`);
    const candidateSource = recordedCandidateSource(paths);
    requireRecordedSource(candidateSource, "only the workflow's build step records it. Run npm start, which builds it.");
    requireSameSource(candidateSource, await compiledSourceIdentity(root, git), "discovery would run another candidate than the source shows. Run npm start again.");
    const candidateSha256 = recordedCandidateSha256(paths);
    if (candidateSha256 === undefined) throw new SetupError("The candidate's build recorded no SHA-256; run npm start, which builds it.");
    const other = manifest.runs.find((run) => run.candidateSha256 !== candidateSha256);
    if (other !== undefined) {
      throw new SetupError(`The baseline run ${other.runFolder} captured the candidate ${other.candidateSha256.slice(0, 12)}, not the built one (${candidateSha256.slice(0, 12)}); run npm start again.`);
    }
    const caseFileSha256 = sha256Text(readFileSync(options.caseFile, "utf8"));
    const cases = fixtureCases(options.caseFile, caseFileSha256);
    const registry = readRegistry(this.dependencies.registry);
    const timings = cases[0]!;
    if (registry !== null && (registry.startupDelaySeconds !== timings.startupDelaySeconds || registry.settleMilliseconds !== timings.settleMilliseconds)) {
      throw new SetupError(`The registry renders its cases with a startup delay of ${registry.startupDelaySeconds} s and a settle time of ${registry.settleMilliseconds} ms, but ${options.caseFile} has ${timings.startupDelaySeconds} s and ${timings.settleMilliseconds} ms: a scenario would be replayed under timings it was not proven with.`);
    }
    const fingerprints = await this.dependencies.buildTools(captureOptions(options), signal);
    const proved = provedFor(registry, manifest.sourceSha256);
    const targets = computeTargets({ baselineThread: options.from, inventory: baseline.inventory, manifest, provedControls: proved.controls, provedInteractions: proved.interactions });
    writeFileSync(folders.targets, `${JSON.stringify(targets, null, 2)}\n`);
    log(`Discovery: ${targets.targets.length} targets from thread ${options.from}; ${targets.outOfReach.reduce((sum, item) => sum + item.count, 0)} bindings out of the actions' reach.`);
    const prepared = {
      baselineFolder, baselineDigest: baseline.digest, sourceSha256: manifest.sourceSha256, candidateSha256, candidateSource, caseFileSha256, fingerprints, targetsPath: folders.targets, targets: targets.targets.length,
      registryEntries: registry?.entries.length ?? 0, coverageBefore: coverageOf(manifest),
    };
    if (targets.targets.length === 0) return { ...prepared, snapshot: null, rankContext: null };
    const snapshot = await createSourceSnapshot(root, folders.source, git);
    requireSameSource(candidateSource, snapshot.compiledIdentity, "the jobs would read another source than the candidate's. Run npm start again.");
    const fixes = readArchivedFixes(fixArchiveOf(fixesRootOf(root)));
    const priors = rankPriors(targets.targets.map((target) => ({
      target, classFiles: classFiles(baseline.inventory.classes.find((item) => item.name === target.class)!),
      fixtureCases: cases.filter((item) => item.mode === target.mode).map((item) => item.name),
    })), fixes);
    const sealed = await sealRankContext({
      baselineThread: options.from, sourceSha256: manifest.sourceSha256, tabTexts: tabTexts(cases, baseline, snapshot.folder),
      source: contextSource(snapshot, candidateSha256), targets: targets.targets, fixtures: cases, priors,
    }, folders.rank);
    log(`Discovery: rank context sealed with ${priors.length} priors of ${fixes.length} archived fix changes.`);
    return { ...prepared, snapshot: { folder: snapshot.folder, identity: snapshot.identity, commit: snapshot.commit }, rankContext: { folder: folders.rank, hash: sealed.hash } };
  }

  private jobInput(state: DiscoveryStateValue, signal: AbortSignal | undefined): JobInput {
    return { threadId: state.threadId, options: state.options, spentMs: state.agentMilliseconds, ...(signal === undefined ? {} : { signal }) };
  }

  private prepared(state: DiscoveryStateValue): Prepared & { snapshot: NonNullable<Prepared["snapshot"]>; rankContext: NonNullable<Prepared["rankContext"]> } {
    const { prepared } = state;
    if (prepared === null || prepared.snapshot === null || prepared.rankContext === null) throw new Error("A discovery job ran before its context was sealed.");
    return prepared as Prepared & { snapshot: NonNullable<Prepared["snapshot"]>; rankContext: NonNullable<Prepared["rankContext"]> };
  }

  /** Runs the rank job on the sealed context. */
  async rank(state: DiscoveryStateValue, store: BaseStore, signal?: AbortSignal): Promise<{ rank: JobState<RankOutput>; chargedMs: number }> {
    const prepared = this.prepared(state);
    const context = readSealed(prepared.rankContext.folder, prepared.rankContext.hash, RankContextSchema);
    const tuning = dispatchedTuningOf(state.options.tuning, "rank");
    const step = await this.dependencies.jobs.run({
      kind: "rank", label: "rank", recordPrefix: `${state.threadId}/rank`, subject: { kind: "discovery-thread", id: state.threadId },
      contextFolder: prepared.rankContext.folder, contextHash: prepared.rankContext.hash, snapshotFolder: prepared.snapshot.folder,
      logsFolder: this.dependencies.folders.thread(state.threadId).logs, promptVersion: tunedPromptVersion(rankPromptVersion, tuning), prompt: (paths) => rankPrompt(context, paths, tuning),
      schema: RankOutputSchema, validate: (output) => validateRank(output, context),
    }, state.rankJob, this.jobInput(state, signal), store);
    return { rank: step.state, chargedMs: step.chargedMs };
  }

  /** Selects the best targets that are not infeasible and seals a scenario context for each. */
  async select(state: DiscoveryStateValue): Promise<{ selected: string[]; scenarios: Record<string, ScenarioJob> }> {
    const prepared = this.prepared(state);
    const output = state.rankJob.answer?.output;
    if (output === undefined) throw new Error("Selection ran without a rank answer.");
    const chosen = selectableRankings(output).slice(0, state.options.targets);
    const targets = readDocument(prepared.targetsPath, TargetsDocumentSchema) as TargetsDocument;
    const baseline = readBaseline(prepared.baselineFolder, this.dependencies.repositoryRoot, prepared.baselineDigest);
    const cases = fixtureCases(state.options.caseFile, prepared.caseFileSha256);
    const labels = knownLabels(baseline.inventory, baseline.manifest, readLanguageStrings(prepared.snapshot.folder));
    const texts = tabTexts(cases, baseline, prepared.snapshot.folder);
    const scenarios: Record<string, ScenarioJob> = {};
    for (const [position, ranking] of chosen.entries()) {
      const target = targets.targets.find((item) => item.id === ranking.targetId)!;
      const folder = this.dependencies.folders.thread(state.threadId).scenario(position + 1);
      const sealed = await sealScenarioContext({
        baselineThread: state.options.from, sourceSha256: prepared.sourceSha256, tabTexts: texts,
        source: { folder: "../source", identity: prepared.snapshot.identity, commit: prepared.snapshot.commit, candidate: prepared.candidateSha256 },
        target, rank: { score: ranking.score, feasibility: ranking.feasibility, case: ranking.case, reason: ranking.reason },
        fixtures: cases, labels,
      }, folder);
      scenarios[target.id] = {
        ...pendingJob<ScenarioOutput>(), targetId: target.id, index: position + 1, contextFolder: folder, contextHash: sealed.hash, ranking,
        validation: null, case: null, scenario: null,
      };
    }
    this.dependencies.log(`Discovery: ${chosen.length} targets selected: ${chosen.map((ranking) => `${ranking.targetId} (${ranking.score})`).join(", ") || "none"}.`);
    return { selected: chosen.map((ranking) => ranking.targetId), scenarios };
  }

  /** Runs one target's scenario job on its sealed context. */
  async scenario(state: DiscoveryStateValue, targetId: string, store: BaseStore, signal?: AbortSignal): Promise<{ update: ScenarioUpdate; chargedMs: number }> {
    const prepared = this.prepared(state);
    const job = state.scenarios[targetId];
    if (job === undefined) throw new Error(`No scenario of target ${targetId}.`);
    const context = readSealed(job.contextFolder, job.contextHash, ScenarioContextSchema);
    const tuning = dispatchedTuningOf(state.options.tuning, "scenario");
    const step = await this.dependencies.jobs.run({
      kind: "scenario", label: `scenario ${targetId}`, recordPrefix: `${state.threadId}/${targetId}/scenario`, subject: { kind: "discovery-target", id: targetId },
      contextFolder: job.contextFolder, contextHash: job.contextHash, snapshotFolder: prepared.snapshot.folder,
      logsFolder: this.dependencies.folders.thread(state.threadId).logs, promptVersion: tunedPromptVersion(scenarioPromptVersion, tuning), prompt: (paths) => scenarioPrompt(context, paths, tuning),
      schema: ScenarioOutputSchema, validate: (output) => validateScenario(output, context),
    }, job, this.jobInput(state, signal), store);
    return { update: { targetId, ...step.state }, chargedMs: step.chargedMs };
  }

  waitForQuota(marks: Parameters<DiscoveryJobs["waitForQuota"]>[0], signal?: AbortSignal): Promise<void> {
    return this.dependencies.jobs.waitForQuota(marks, signal);
  }

  /** Validates every plan against its context's vocabulary and names the valid ones' cases. */
  validate(state: DiscoveryStateValue): Record<string, ScenarioUpdate> {
    if (state.prepared === null) throw new Error("Validation ran before discovery was prepared.");
    const cases = fixtureCases(state.options.caseFile, state.prepared.caseFileSha256);
    const updates: Record<string, ScenarioUpdate> = {};
    for (const job of Object.values(state.scenarios)) {
      const plan = job.answer?.output.plan;
      if (job.status !== "done" || plan == null) continue;
      const context = readSealed(job.contextFolder, job.contextHash, ScenarioContextSchema);
      const labels = new Set(readLabels(job.contextFolder, context));
      const reasons = validatePlan(plan, { fixtures: context.fixtures, tabTexts: context.tabTexts, labels });
      if (reasons.length > 0) {
        this.dependencies.log(`scenario ${job.targetId}: invalid plan: ${reasons.join("; ")}.`);
        updates[job.targetId] = { targetId: job.targetId, validation: reasons };
        continue;
      }
      const fixture = cases.find((item) => item.name === plan.case)!;
      const scenario = scenarioName(job.targetId, plan.case, scenarioActions(plan));
      const name = caseName(fixture.mode, fixture.fixturePath, scenario);
      updates[job.targetId] = { targetId: job.targetId, validation: [], case: name, scenario };
    }
    return updates;
  }
}

/** A sealed context, read again; one that changed since it was sealed is a setup error. */
export function readSealed<T extends RankContext | ScenarioContext>(folder: string, hash: string, schema: z.ZodType<T>): T {
  const context = readDocument(join(folder, "context.json"), schema);
  if (discoveryContextHash(context) !== hash) throw new SetupError(`The context in ${folder} changed after it was sealed.`);
  verifyContextFiles(folder, context);
  return context;
}
