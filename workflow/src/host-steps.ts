import { join } from "node:path";
import type { BaseStore } from "@langchain/langgraph-checkpoint";
import type { PlannedCase } from "./cases/case-plan.js";
import type { TriageInput, WorkflowSteps } from "./graph/workflow-graph.js";
import type { TriageSummary } from "./graph/workflow-state.js";
import type { HostRunner } from "./host/host-runner.js";
import type { ScratchFolder } from "./host/scratch-folder.js";
import { recordCandidateSource } from "./diagnosis/candidate-source.js";
import { compiledSourceIdentity, processGit } from "./diagnosis/source-snapshot.js";
import { SetupError } from "./host/setup-error.js";
import type { RunOptions } from "./options/run-options.js";
import type { WorkflowPaths } from "./paths.js";
import { readEnvironmentFingerprint, type CaptureStep } from "./steps/capture-step.js";
import { requireCurrentReport, type CompareStep } from "./steps/compare-step.js";
import { fingerprintInputs, type InputFingerprints } from "./steps/input-fingerprints.js";
import type { StepContext, StepOutcome } from "./steps/step-outcome.js";
import type { StepStore } from "./steps/step-store.js";
import { runTriage } from "./triage/triage.js";

const toolProjects = ["Parity.Capture", "Parity.Compare"];

/** The graph's steps on the real host: builds, the parity tools and triage. */
export class HostSteps implements WorkflowSteps {
  constructor(
    private readonly paths: WorkflowPaths,
    private readonly host: HostRunner,
    private readonly captureStep: CaptureStep,
    private readonly compareStep: CompareStep,
    private readonly stepStore: StepStore,
    private readonly now: () => Date,
    private readonly createScratchFolder: (prefix: string) => ScratchFolder,
  ) {}

  async build(options: RunOptions, buildCandidate: boolean, signal?: AbortSignal): Promise<InputFingerprints> {
    // The candidate and the tools share no project, so they build side by side in the CPU pool.
    const candidate = buildCandidate ? this.buildCandidate(signal) : Promise.resolve();
    const tools = this.buildTools(signal);
    const [candidateBuild, toolBuilds] = await Promise.allSettled([candidate, tools]);
    for (const build of [candidateBuild, toolBuilds]) {
      if (build.status === "rejected") throw build.reason;
    }
    const environment = await readEnvironmentFingerprint(this.paths, this.host, this.createScratchFolder, "environment thread", signal);
    return fingerprintInputs(this.paths, options, environment);
  }

  /** Builds the candidate and records the compiled source it was built from, taken before the build so an edit during it shows. */
  async buildCandidate(signal?: AbortSignal): Promise<void> {
    const compiled = await compiledSourceIdentity(this.paths.repositoryRoot, processGit(this.paths.repositoryRoot));
    const status = await this.host.run({
      resource: "cpu", label: "build candidate", command: process.execPath,
      args: [join(this.paths.repositoryRoot, "parity", "scripts", "build-candidate.mjs")],
      ...(signal === undefined ? {} : { signal }),
    });
    if (status !== 0) throw new SetupError(`The candidate build failed (exit ${status}); nothing was captured.`);
    recordCandidateSource(this.paths, compiled);
  }

  private async buildTools(signal: AbortSignal | undefined): Promise<void> {
    // One after the other: both projects build the shared Parity.Cases and Parity.Imaging projects.
    for (const project of toolProjects) {
      const status = await this.host.run({
        resource: "cpu", label: `build ${project}`, command: "dotnet",
        args: ["build", join(this.paths.repositoryRoot, "parity", "src", project, `${project}.csproj`), "-c", "Release", "--nologo", "-v", "quiet"],
        ...(signal === undefined ? {} : { signal }),
      });
      if (status !== 0) throw new SetupError(`The ${project} build failed (exit ${status}).`);
    }
  }
  capture(context: StepContext, item: PlannedCase): Promise<StepOutcome> {
    return this.captureStep.run(context, item);
  }

  compare(context: StepContext, capture: StepOutcome): Promise<StepOutcome> {
    return this.compareStep.run(context, capture);
  }

  async triage(input: TriageInput, store: BaseStore): Promise<TriageSummary> {
    for (const outcome of Object.values(input.compares)) await requireCurrentReport(this.stepStore, outcome);
    return runTriage(input, store, this.paths.threadFolder(input.threadId), this.now());
  }
}
