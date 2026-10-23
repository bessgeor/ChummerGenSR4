import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Explanation, HypothesisOutput, ChallengeOutput } from "../src/diagnosis/job-schemas.js";
import { InMemoryStore } from "@langchain/langgraph";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { QuotaWaiter } from "../src/diagnosis/quota-waiter.js";
import type { EvalContext } from "../src/evals/eval-commands.js";
import { noLabels, type EvalRecord } from "../src/evals/eval-record.js";
import { createScratchFolder } from "../src/host/scratch-folder.js";
import { workflowPaths } from "../src/paths.js";
import { FakeAgents } from "./diagnosis-harness.js";
import { scratch, triageDocument } from "./diagnosis-fixtures.js";

export const hash = (character: string) => character.repeat(64);

export const explanation = (overrides: Partial<Explanation> = {}): Explanation => ({
  claim: "The label moved.", mechanism: "layout", locations: [{ path: "Chummer/frmCreate.cs", symbol: null, line: 5 }],
  evidence: "e", confidence: 0.6,
  predictions: [{ case: "build-alpha", capture: "skills", expect: "differs", why: "w" }],
  ...overrides,
});

export const hypothesisOutput = (value: Explanation | null = explanation()): HypothesisOutput =>
  value === null ? { outcome: "abstain", reason: "r", explanation: null } : { outcome: "hypothesis", reason: "r", explanation: value };

export const challengeOutput = (value: Explanation | null): ChallengeOutput =>
  value === null ? { outcome: "no_alternative", reason: "r", alternative: null } : { outcome: "alternative", reason: "r", alternative: value };

/** A succeeded workflow record of a cluster. */
export function record(overrides: Partial<EvalRecord> = {}): EvalRecord {
  return {
    schemaVersion: 2, recordId: "wf-1/d-0000000000000100/hypothesis/1", jobKind: "hypothesis", origin: "workflow", threadId: "wf-1",
    subject: { kind: "discrepancy-cluster", id: "d-0000000000000100" }, challenged: null, contextHash: hash("c"), promptVersion: "hypothesis-v2",
    agent: { provider: "claude", model: null, effort: "medium" }, startedUtc: "2026-10-01T10:00:00.000Z", finishedUtc: "2026-10-01T10:01:00.000Z",
    durationMs: 60_000, usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, costUsd: 0.1 },
    result: { status: "succeeded", message: null }, output: hypothesisOutput(), labels: noLabels,
    ...overrides,
  };
}

export function writeFile(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/** A git repository whose history has a base, a regression of line 5 of `Chummer/frmCreate.cs` and its fix. */
export function fixRepository() {
  const root = scratch("workflow-benchmark-");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "core.autocrlf", "false");
  const lines = Array.from({ length: 20 }, (_, index) => `    int field${index + 1};`);
  const source = (line5: string) => ["class frmCreate", "{", ...lines.slice(0, 2), line5, ...lines.slice(3)].join("\n") + "\n";
  writeFile(root, "Chummer/frmCreate.cs", source("    Point location = new Point(628, 32);"));
  writeFile(root, "README.md", "readme");
  git("add", "-A");
  git("commit", "-q", "-m", "base", "--date", "2026-09-01T00:00:00Z");
  writeFile(root, "Chummer/frmCreate.cs", source("    Point location = new Point(640, 32);"));
  git("commit", "-q", "-am", "regression", "--date", "2026-09-02T00:00:00Z");
  const regression = git("rev-parse", "HEAD");
  writeFile(root, "Chummer/frmCreate.cs", source("    Point location = new Point(628, 32);"));
  process.env["GIT_COMMITTER_DATE"] = "2026-10-02T00:00:00Z";
  git("commit", "-q", "-am", "fix");
  delete process.env["GIT_COMMITTER_DATE"];
  const fix = git("rev-parse", "HEAD");
  writeFile(root, "README.md", "readme 2");
  git("commit", "-q", "-am", "docs only");
  const docs = git("rev-parse", "HEAD");
  const threads = join(root, "out", "threads");
  writeFile(threads, "wf-1/triage.json", JSON.stringify(triageDocument("wf-1", [{ case: "build-alpha", capture: "skills", x: 100 }], { "build-alpha": join(root, "runs", "a") })));
  return { root, git, regression, fix, docs, threads, benchmark: join(root, "benchmark") };
}

/** An evaluation context over an in-memory store, with fake agents and a quota waiter that does not sleep. */
export function evalContext(overrides: Partial<EvalContext> = {}): EvalContext & { readonly lines: string[] } {
  const lines: string[] = [];
  const agents = new FakeAgents();
  return {
    paths: workflowPaths(scratch("workflow-eval-")), store: new InMemoryStore(), git: () => "", now: () => new Date("2026-10-02T09:00:00Z"),
    log: (line) => lines.push(line), agentSettings: () => resolveAgentSettings(undefined), agents: () => agents, certificatesFolder: () => join(scratch("workflow-certificates-"), "certificates"),
    quota: new QuotaWaiter("p", async () => undefined), createScratchFolder, lines,
    ...overrides,
  };
}