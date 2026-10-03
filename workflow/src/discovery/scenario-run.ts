import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { CaptureResultsSchema } from "../../../contracts/generated/typescript/parity-capture-results.js";
import { ExecutionCoverageSchema } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { planCases, readCaseFile } from "../cases/case-plan.js";
import { setLabels, type DiscoveryOutcome } from "../evals/eval-record.js";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import { requireCoveredCases } from "../steps/capture-step.js";
import type { InputFingerprints } from "../steps/input-fingerprints.js";
import { readDocument } from "../steps/read-document.js";
import type { DiscoveryPaths } from "./discovery-paths.js";
import { captureOptions, fixtureCases, readBaseline } from "./discovery-service.js";
import type { DiscoveryStateValue, Execution, Registered, ScenarioJob } from "./discovery-state.js";
import { scenarioActions } from "./plan-validator.js";
import { isProven, proveScenarios, type ScenarioProof } from "./proof.js";
import type { RegistryEntry } from "./registry-document.js";
import { admit, emptyRegistry, provedFor, readRegistry, writeRegistry, type RegistryPaths } from "./registry.js";
import { actionsSha256, fixtureReference, writeScenarioCaseFile } from "./scenario-cases.js";

export type ScenarioRunDependencies = {
  readonly repositoryRoot: string;
  readonly folders: DiscoveryPaths;
  /** The scenario registry and its case file. */
  readonly registry: RegistryPaths;
  /** Runs the capture runner on the desktop lane for the named cases of the options' case file, with UI trees. */
  readonly capture: (options: RunOptions, cases: readonly string[], signal?: AbortSignal) => Promise<{ readonly status: 0 | 1 | 2; readonly runFolder: string }>;
  /** The capture inputs that changed since the thread's fingerprints were taken. */
  readonly changedInputs: (options: RunOptions, fingerprints: InputFingerprints) => Promise<readonly string[]>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

/** The scenarios whose plans passed validation, in selection order. */
export function validScenarios(state: Pick<DiscoveryStateValue, "scenarios">): ScenarioJob[] {
  return Object.values(state.scenarios).filter((job) => job.validation !== null && job.validation.length === 0 && job.case !== null).sort((left, right) => left.index - right.index);
}

/** The label outcome of a scenario job that answered, or null for one that failed or never ran. */
export function scenarioOutcome(job: ScenarioJob, proof: ScenarioProof | undefined): DiscoveryOutcome | null {
  if (job.status !== "done" || job.answer === null) return null;
  if (job.answer.output.outcome === "abstain") return "abstained";
  if (job.validation !== null && job.validation.length > 0) return "invalid-plan";
  if (proof === undefined) return null;
  if (proof.execution === "execution-failed") return "execution-failed";
  return isProven(proof) ? "proven" : "not-proven";
}

/** Runs the valid scenarios, proves what their trees show, admits them to the registry and labels the jobs' records. */
export class ScenarioRun {
  constructor(private readonly dependencies: ScenarioRunDependencies) {}

  /** One capture run of every valid scenario, from a case file generated in the thread folder. */
  async execute(state: DiscoveryStateValue, signal?: AbortSignal): Promise<Execution> {
    const { prepared } = state;
    if (prepared === null) throw new Error("The scenario run started before discovery was prepared.");
    const folders = this.dependencies.folders.thread(state.threadId);
    const fixtures = fixtureCases(state.options.caseFile, prepared.caseFileSha256);
    const valid = validScenarios(state);
    writeScenarioCaseFile(folders.cases, readCaseFile(state.options.caseFile), valid.map((job) => {
      const plan = job.answer!.output.plan!;
      const fixture = fixtures.find((item) => item.name === plan.case)!;
      return { fixturePath: fixture.fixturePath, mode: fixture.mode, scenario: job.scenario!, actions: scenarioActions(plan) };
    }));
    const names = valid.map((job) => job.case!);
    const planned = planCases(folders.cases, [], []).cases.map((item) => item.name);
    if (planned.join("\n") !== names.join("\n")) throw new SetupError(`The generated case file ${folders.cases} plans ${planned.join(", ")}, not ${names.join(", ")}.`);
    const changed = await this.dependencies.changedInputs(captureOptions(state.options), prepared.fingerprints);
    if (changed.length > 0) throw new SetupError(`Inputs changed since the thread started (${changed.join(", ")}); start a new thread.`);
    this.dependencies.log(`Discovery capture: ${names.length} scenarios in one run.`);
    const { status, runFolder } = await this.dependencies.capture(captureOptions(state.options, folders.cases), names, signal);
    requireCoveredCases("discovery capture", runFolder, names);
    const coverage = readDocument(join(runFolder, "coverage.json"), ExecutionCoverageSchema);
    const results = readDocument(join(runFolder, "results.json"), CaptureResultsSchema);
    return {
      runFolder, runId: coverage.runId, status, coverageValid: coverage.valid, invalidReasons: coverage.invalidReasons, failures: coverage.totals.failures,
      rows: { passed: results.results.filter((row) => row.passed).length, failed: results.results.filter((row) => !row.passed).length }, cases: names,
    };
  }

  /** Proves each executed scenario's coverage, admits what proved something or differs, and sets the `discovery` labels. */
  async register(state: DiscoveryStateValue, store: BaseStore): Promise<Registered> {
    const { prepared } = state;
    if (prepared === null) throw new Error("Registration ran before discovery was prepared.");
    const root = this.dependencies.repositoryRoot;
    const paths = this.dependencies.registry;
    const stored = readRegistry(paths) ?? emptyRegistry(readCaseFile(state.options.caseFile));
    // A register step that runs again after an interruption finds its own admissions: they neither count as earlier proofs nor as duplicates.
    const registry = { ...stored, entries: stored.entries.filter((entry) => entry.provenance.thread !== state.threadId) };
    const proofs: Record<string, ScenarioProof> = {};
    let manifestPath: string | null = null;
    const valid = validScenarios(state);
    const fixtures = fixtureCases(state.options.caseFile, prepared.caseFileSha256);
    const fixtureOf = (job: ScenarioJob) => fixtures.find((item) => item.name === job.answer!.output.plan!.case)!;
    if (state.execution !== null) {
      const baseline = readBaseline(prepared.baselineFolder, root);
      const proved = provedFor(registry, prepared.sourceSha256);
      const proven = proveScenarios({
        runFolder: state.execution.runFolder, inventory: baseline.inventory, scope: baseline.scope, baseline: baseline.manifest,
        provedControls: proved.controls, provedInteractions: proved.interactions,
        scenarios: valid.map((job) => ({ name: job.case!, mode: fixtureOf(job).mode, captures: captureNamesOf(job) })),
      });
      manifestPath = join(this.dependencies.folders.thread(state.threadId).inventory, "coverage-manifest.json");
      mkdirSync(dirname(manifestPath), { recursive: true });
      writeFileSync(manifestPath, `${JSON.stringify(proven.manifest, null, 2)}\n`);
      for (const proof of proven.proofs) proofs[proof.case] = proof;
    }
    const admittedUtc = this.dependencies.now().toISOString();
    const candidates = valid.flatMap((job): RegistryEntry[] => {
      const proof = proofs[job.case!];
      if (proof === undefined || proof.execution !== "executed" || (!isProven(proof) && proof.visual?.outcome !== "finding")) return [];
      const plan = job.answer!.output.plan!;
      const fixture = fixtureOf(job);
      const actions = scenarioActions(plan);
      return [{
        case: job.case!, fixtureCase: plan.case, mode: fixture.mode, scenario: job.scenario!, fixture: fixtureReference(dirname(paths.caseFile), fixture.fixturePath), actions,
        actionsSha256: actionsSha256(plan.case, actions), target: job.targetId, sourceSha256: prepared.sourceSha256,
        proofs: { controls: [...proof.proofs.controls], interactions: [...proof.proofs.interactions] },
        visual: { outcome: proof.visual!.outcome, differing: [...proof.visual!.differing] },
        provenance: { thread: state.threadId, runId: state.execution!.runId, records: [state.rankJob.answer!.recordId, job.answer!.recordId] }, admittedUtc,
      }];
    });
    const admission = admit(registry, candidates);
    if (admission.admitted.length > 0 || admission.registry.entries.length !== stored.entries.length) writeRegistry(paths, admission.registry);
    await this.label(state, store, proofs, admittedUtc);
    return { proofs, admitted: admission.admitted, duplicates: admission.duplicates, manifestPath, registryEntries: admission.registry.entries.length };
  }

  private async label(state: DiscoveryStateValue, store: BaseStore, proofs: Readonly<Record<string, ScenarioProof>>, labelledUtc: string): Promise<void> {
    const outcomes: DiscoveryOutcome[] = [];
    for (const job of Object.values(state.scenarios)) {
      const proof = job.case === null ? undefined : proofs[job.case];
      const outcome = scenarioOutcome(job, proof);
      if (outcome === null) continue;
      outcomes.push(outcome);
      const differing = proof?.visual === null || proof?.visual === undefined ? null : proof.visual.differing.length;
      await setLabels(store, { jobKind: "scenario", recordId: job.answer!.recordId }, { discovery: { outcome, differing, labelledUtc } });
    }
    if (state.rankJob.answer === null) return;
    const executed = outcomes.filter((outcome) => outcome === "proven" || outcome === "not-proven");
    const rank: DiscoveryOutcome = outcomes.includes("proven") ? "proven" : executed.length > 0 ? "not-proven" : "untested";
    await setLabels(store, { jobKind: "rank", recordId: state.rankJob.answer.recordId }, { discovery: { outcome: rank, differing: null, labelledUtc } });
  }
}

function captureNamesOf(job: ScenarioJob): string[] {
  return job.answer!.output.plan!.actions.filter((action) => action.type === "capture").map((action) => action.name!);
}
