import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { InMemoryStore, MemorySaver } from "@langchain/langgraph";
import type { CaptureResults } from "../../contracts/generated/typescript/parity-capture-results.js";
import type { ExecutionCoverage } from "../../contracts/generated/typescript/parity-execution-coverage.js";
import type { UiNode } from "../../contracts/generated/typescript/parity-ui-tree.js";
import { notStarted, type AgentFailure, type AgentJob, type AgentResult, type AgentRunner, type NotStarted } from "../src/agents/agent-job.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { finishOutput } from "../src/agents/job-output.js";
import { planCases } from "../src/cases/case-plan.js";
import { recordCandidateSha256, recordCandidateSource } from "../src/diagnosis/candidate-source.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import { compiledSourceIdentity, compiledSourcePaths, processGit } from "../src/diagnosis/source-snapshot.js";
import type { DiscoverArguments } from "../src/discovery/discover-arguments.js";
import { discoveryPaths } from "../src/discovery/discovery-paths.js";
import { composeDiscovery, type DiscoveryGraph, type DiscoveryHost, type DiscoveryRunner } from "../src/discovery/discovery-runner.js";
import type { DiscoveryOptions } from "../src/discovery/discovery-state.js";
import { registryPaths } from "../src/discovery/registry.js";
import { runDiscovery } from "../src/discovery/run-discovery.js";
import { ScenarioRun } from "../src/discovery/scenario-run.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { buildCoverageManifest } from "../src/inventory/coverage-manifest.js";
import { readRunObservation } from "../src/inventory/run-observations.js";
import { readScope } from "../src/inventory/scope.js";
import { buildSourceInventory, designerPaths } from "../src/inventory/source-inventory.js";
import type { WorkflowPaths } from "../src/paths.js";
import type { InputFingerprints } from "../src/steps/input-fingerprints.js";
import { nodes, tabItem, writeRun, type CaseSpec } from "./inventory-fixtures.js";
import type { DispatchedTuning } from "../src/tuning/tuning.js";

const designer = `namespace Chummer
{
    partial class frmCreate
    {
        private void InitializeComponent()
        {
            this.tabCharacterTabs.Controls.Add(this.tabCommon);
            this.tabCharacterTabs.Controls.Add(this.tabSkills);
            this.tabCharacterTabs.SelectedIndexChanged += new System.EventHandler(this.tabCharacterTabs_SelectedIndexChanged);
            this.tabCommon.Controls.Add(this.lblNuyen);
            this.tabCommon.Text = "Common";
            this.tabSkills.Controls.Add(this.lblKarma);
            this.tabSkills.Text = "Skills";
            this.lblNuyen.Text = "Nuyen";
            this.lblKarma.Text = "Karma";
            this.Controls.Add(this.tabCharacterTabs);
            this.Name = "frmCreate";
        }

        private System.Windows.Forms.TabControl tabCharacterTabs;
        private System.Windows.Forms.TabPage tabCommon;
        private System.Windows.Forms.TabPage tabSkills;
        private System.Windows.Forms.Label lblNuyen;
        private System.Windows.Forms.Label lblKarma;
    }
}
`;

const code = `namespace Chummer
{
    public partial class frmCreate : Form
    {
        private void tabCharacterTabs_SelectedIndexChanged(object sender, EventArgs e) { }
    }
}
`;

function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

export const candidateSha256 = "c".repeat(64);
export const baselineThread = "wf-baseline";
export const fixtureCase = "build-Alpha";

/** The tree of the build form showing one tab page with its label. */
export function formTree(page: "Common" | "Skills"): UiNode[] {
  return nodes([["frmCreate", null], ["tabCharacterTabs", 0], tabItem(page, 1), [page === "Common" ? "lblNuyen" : "lblKarma", 2]]);
}

/**
 * A git repository with one build form (two tab pages, a label on each and a selection binding), its scope, a case file of
 * one fixture, an English language file, a baseline thread whose capture of `common` showed the first page, and the
 * candidate's records.
 */
export async function discoveryRepository(): Promise<{ root: string; paths: WorkflowPaths; out: string }> {
  const root = mkdtempSync(join(tmpdir(), "discovery-repo-"));
  const out = mkdtempSync(join(tmpdir(), "discovery-out-"));
  write(root, "Chummer/frmCreate.Designer.cs", designer);
  write(root, "Chummer/frmCreate.cs", code);
  write(root, "Core/Core.cs", "class Core {}");
  write(root, "bin/data/skills.xml", "<skills/>");
  write(root, "bin/lang/en-us.xml", "<chummer><strings>\n<string><key>Tab_Skills</key><text>Skills</text></string>\n<string><key>Label_Karma</key><text>Karma</text></string>\n</strings></chummer>\n");
  write(root, "parity/inventory/scope.json", JSON.stringify({ classes: { frmCreate: { scope: "active", reason: "the build form" } }, deferredEvents: {} }));
  write(root, "parity/fixtures/characters/Alpha.chum", "<character/>");
  write(root, "parity/cases/characters.json", JSON.stringify({
    startupDelaySeconds: 3, settleMilliseconds: 300, sequences: {}, buildActions: [{ type: "capture", name: "common" }], careerActions: [{ type: "capture", name: "common" }],
    characters: [{ path: "../fixtures/characters/Alpha.chum", mode: "build" }],
  }));
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  const paths = {
    repositoryRoot: root, workflowFolder: join(out, "workflow"), checkpoints: join(out, "checkpoints.sqlite"), store: join(out, "store.sqlite"), steps: join(out, "steps"), laneScratch: join(out, "lane-scratch"),
    canonicalApp: join(root, "bin"), candidateApp: join(out, "candidate", "bin"), captureTools: join(out, "tools"), compareTools: join(out, "tools"),
    evalsFolder: join(out, "evals"), benchmark: join(out, "benchmark"), certificates: join(out, "certificates"), threadFolder: (id: string) => join(out, "threads", id),
  } satisfies WorkflowPaths;
  mkdirSync(paths.candidateApp, { recursive: true });
  recordCandidateSource(paths, await compiledSourceIdentity(root, processGit(root)));
  recordCandidateSha256(paths, candidateSha256);
  const inventory = buildSourceInventory(root, designerPaths(compiledSourcePaths(root, processGit(root))));
  const scope = readScope(join(root, "parity", "inventory", "scope.json"));
  const run = writeRun(join(out, "runs"), "20261003T100000Z-baseline", [{
    case: fixtureCase, actions: [{ action: "capture:common", outcome: "performed" }], captures: [{ capture: "common", outcome: "performed", tree: formTree("Common") }],
  }]);
  const manifest = buildCoverageManifest({ inventory, scope, scopePath: "parity/inventory/scope.json", plan: [{ name: fixtureCase, mode: "build", captures: ["common"] }], runs: [readRunObservation(run)] });
  write(paths.threadFolder(baselineThread), "inventory/source-inventory.json", JSON.stringify(inventory));
  write(paths.threadFolder(baselineThread), "inventory/coverage-manifest.json", JSON.stringify(manifest));
  return { root, paths, out };
}

/** What the fake agent does for a job: answer (validated like a real adapter), fail, or answer after `durationMs`. */
export type Reply = { readonly answer: unknown; readonly durationMs?: number } | { readonly failure: AgentFailure };

export class FakeAgents implements AgentRunner {
  readonly calls: { kind: string; label: string; prompt: string }[] = [];

  constructor(private readonly reply: (job: AgentJob<unknown>, attempt: number) => Reply) {}

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T> | NotStarted> {
    if (job.mayStart?.() === false) return notStarted;
    const attempt = this.calls.filter((call) => call.label === job.label).length + 1;
    this.calls.push({ kind: job.kind, label: job.label, prompt: job.prompt });
    const reply = this.reply(job as AgentJob<unknown>, attempt);
    const common = { usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costUsd: 0.01 }, durationMs: "durationMs" in reply ? reply.durationMs ?? 1000 : 1000, sessionId: null };
    let result: AgentResult<T>;
    if ("failure" in reply) result = { ...common, ok: false, failure: reply.failure };
    else {
      const finished = finishOutput(job, reply.answer);
      result = finished.ok ? { ...common, ok: true, output: finished.output } : { ...common, ok: false, failure: finished.failure };
    }
    job.onResult?.(result);
    return result;
  }
}

/** A fake scenario capture: a run of the generated case file's cases, every action performed, with the trees `treeFor` gives. */
export class FakeCapture {
  readonly calls: { caseFile: string; cases: readonly string[] }[] = [];

  constructor(
    private readonly out: string,
    private readonly treeFor: (caseName: string, capture: string) => UiNode[],
    private readonly options: { failed?: string; differing?: readonly string[]; status?: 0 | 1 | 2; /** Thrown by the first call only. */ error?: Error; /** The candidate SHA-256 the run's summary records. */ candidateSha256?: string } = {},
  ) {}

  async run(caseFile: string, cases: readonly string[]): Promise<{ status: 0 | 1 | 2; runFolder: string }> {
    this.calls.push({ caseFile, cases });
    if (this.options.error !== undefined && this.calls.length === 1) throw this.options.error;
    const planned = planCases(caseFile, [], []).cases.filter((item) => cases.includes(item.name));
    const specs: CaseSpec[] = planned.map((item) => ({
      case: item.name,
      actions: item.actions.map((action) => ({ action: `${action.type}:${action.name ?? action.label ?? action.milliseconds}`, outcome: "performed" as const })),
      captures: item.actions.filter((action) => action.type === "capture").map((action) => ({ capture: action.name!, outcome: "performed" as const, tree: this.treeFor(item.name, action.name!) })),
    }));
    const runId = `20261003T12000${this.calls.length}Z-scenario`;
    const folder = writeRun(join(this.out, "runs"), runId, specs);
    const coverage = JSON.parse(readFileSync(join(folder, "coverage.json"), "utf8")) as ExecutionCoverage;
    for (const item of coverage.cases) {
      item.sides = item.sides.map((side) => ({
        ...side, contiguous: true, notRun: 0,
        failures: item.case === this.options.failed && side.side === "candidate" ? [{ index: 1, action: "waitFor:Karma", reason: "TimeoutException: timed out" }] : [],
      }));
    }
    coverage.valid = this.options.failed === undefined;
    coverage.invalidReasons = this.options.failed === undefined ? [] : [`failure:${this.options.failed}/candidate`];
    coverage.totals = { ...coverage.totals, failures: this.options.failed === undefined ? 0 : 1 };
    writeFileSync(join(folder, "coverage.json"), JSON.stringify(coverage));
    const results: CaptureResults = {
      runId, threshold: 0.00004,
      results: specs.flatMap((item) => item.captures.map((capture) => {
        const differs = this.options.differing?.includes(`${item.case}/${capture.capture}`) ?? false;
        return { case: item.case, characterFile: "Alpha.chum", mode: "build" as const, capture: capture.capture, passed: !differs, reason: differs ? "visual-difference" as const : "within-threshold" as const, difference: differs ? 0.01 : 0 };
      })),
    };
    writeFileSync(join(folder, "results.json"), JSON.stringify(results));
    if (this.options.candidateSha256 !== undefined) {
      const summary = JSON.parse(readFileSync(join(folder, "summary.json"), "utf8")) as { candidate: { sha256: string } };
      summary.candidate.sha256 = this.options.candidateSha256;
      writeFileSync(join(folder, "summary.json"), JSON.stringify(summary));
    }
    return { status: this.options.status ?? (this.options.failed !== undefined ? 2 : this.options.differing !== undefined ? 1 : 0), runFolder: folder };
  }
}

const fingerprints = {
  canonicalExecutable: "e", canonicalSupportStat: "s", candidate: "k", overlay: "none", captureTools: "t", compareTools: "t", tessdata: "default",
  canonicalSupport: "s", candidateSource: "x", environment: "v",
} satisfies InputFingerprints;

export type Harness = {
  readonly root: string;
  readonly out: string;
  readonly agents: FakeAgents;
  readonly capture: FakeCapture;
  readonly lines: string[];
  readonly store: InMemoryStore;
  readonly waits: number[];
  readonly scenarioRun: ScenarioRun;
  readonly graph: DiscoveryGraph;
  readonly runner: DiscoveryRunner;
  readonly resolveOptions: (args: DiscoverArguments) => DiscoveryOptions;
  run(args?: Partial<DiscoverArguments>): Promise<number>;
  resume(threadId: string): Promise<number>;
};

/** A discovery graph on the synthetic repository with fake agents, a fake capture and the real service. */
export async function discoveryHarness(
  reply: (job: AgentJob<unknown>, attempt: number) => Reply, treeFor: (caseName: string, capture: string) => UiNode[] = (_, capture) => formTree(capture === "common" ? "Common" : "Skills"),
  options: {
    capture?: ConstructorParameters<typeof FakeCapture>[2]; budgetMinutes?: number; repository?: Awaited<ReturnType<typeof discoveryRepository>>; environment?: string;
    /** The active configurations a new thread stores in its options. */
    tuning?: DispatchedTuning;
  } = {},
): Promise<Harness> {
  const { root, paths, out } = options.repository ?? await discoveryRepository();
  const agents = new FakeAgents(reply);
  const capture = new FakeCapture(out, treeFor, options.capture);
  const lines: string[] = [];
  const waits: number[] = [];
  const log = (line: string) => lines.push(line);
  const now = () => new Date("2026-10-03T12:00:00Z");
  const folders = discoveryPaths(out);
  const registry = registryPaths(root);
  const quota = new QuotaWaiter("process-1", async (milliseconds) => { waits.push(milliseconds); }, log);
  const host: DiscoveryHost = {
    buildTools: async () => fingerprints, capture: (runOptions, cases) => capture.run(runOptions.caseFile, cases), changedInputs: async () => [],
    environment: async () => options.environment ?? fingerprints.environment,
  };
  const scenarioRun = new ScenarioRun({ repositoryRoot: root, folders, registry, now, log, capture: host.capture, changedInputs: host.changedInputs, environment: host.environment });
  const store = new InMemoryStore();
  const runner = composeDiscovery({
    repositoryRoot: root, paths, folders, registry, git: processGit(root), host, agents: () => agents, quota, createScratchFolder, checkpointer: new MemorySaver(), store, now, log,
  });
  const graph = runner.graph;
  const settings = resolveAgentSettings({ runBudgetMinutes: options.budgetMinutes ?? 120 });
  const resolveOptions = (args: DiscoverArguments): DiscoveryOptions => ({
    from: args.from, caseFile: args.caseFile ?? join(root, "parity", "cases", "characters.json"), settingsOverlay: null, threshold: null, canonicalCache: null, canonicalCacheSource: "off",
    targets: args.targets, unattended: false, agents: settings, certificates: join(out, "certificates"), ...(options.tuning === undefined ? {} : { tuning: options.tuning }),
  });
  const dependencies = { runner, resolveOptions, certificateProblems: () => [], log, now };
  return {
    root, out, agents, capture, lines, store, waits, scenarioRun, graph, runner, resolveOptions,
    run: (args = {}) => runDiscovery({ kind: "start", arguments: { from: baselineThread, targets: 3, caseFile: null, settingsOverlay: null, threshold: null, canonicalCache: null, liveCanonical: true, unattended: false, ...args } }, dependencies),
    resume: (threadId) => runDiscovery({ kind: "resume", threadId }, dependencies),
  };
}

/** The thread ID a harness run printed. */
export function threadOf(lines: readonly string[]): string {
  const line = lines.find((entry) => entry.startsWith("Discovery thread "));
  if (line === undefined) throw new Error("No discovery thread was started.");
  return line.split(" ")[2]!.replace(/:$/, "");
}
