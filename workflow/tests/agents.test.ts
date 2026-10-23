import { deepStrictEqual, equal, ok, throws } from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { notStarted, wasNotStarted, type AgentJob, type AgentResult, type AgentRunner } from "../src/agents/agent-job.js";
import { resolveExecutable } from "../src/agents/executable.js";
import { agentRunners } from "../src/agents/agent-runners.js";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { classifyFailure, finishOutput, jsonSchemaOf, parseAnswer } from "../src/agents/job-output.js";
import { PooledAgentRunner } from "../src/agents/pooled-agent-runner.js";
import { SetupError } from "../src/host/setup-error.js";
import { loadProfile } from "../src/options/profile.js";

test("usage-limit texts are quota_exhausted, refusals refused, sign-in problems and the rest infra", () => {
  for (const text of [
    "Claude AI usage limit reached|1790886000",
    "You've hit your usage limit. Upgrade to Pro or try again in 2 hours.",
    "You've hit your limit · resets 7pm (Europe/Berlin)",
    "API Error: 429 {\"type\":\"error\",\"error\":{\"type\":\"rate_limit_error\"}}",
    "stream error: usage_limit_reached",
    "Subscription quota exhausted",
    "5-hour limit reached",
  ]) equal(classifyFailure(text), "quota_exhausted", text);
  equal(classifyFailure("Invalid API key · Please run /login"), "infra");
  equal(classifyFailure("Not logged in"), "infra");
  equal(classifyFailure("The model refused to answer this request."), "refused");
  equal(classifyFailure("spawn claude ENOENT"), "infra");
  equal(classifyFailure("Exited with code 1"), "infra");
});

test("only the subscriptions' own limit messages and an HTTP 429 are usage limits; other texts that mention limits are not", () => {
  for (const text of ["Quota file not found", "The request hit a limit reached in the parser", "connect ECONNREFUSED: Connection refused", "Rate limit of the repository host", "error 4290"]) {
    equal(classifyFailure(text), "infra", text);
  }
  equal(classifyFailure("Too many requests", 429), "quota_exhausted");
  equal(classifyFailure("Overloaded", 529), "infra");
  equal(classifyFailure("The assistant refused to continue."), "refused");
  equal(classifyFailure("Blocked by the usage policy."), "refused");
});

const schema = z.strictObject({ answer: z.number() });

test("an answer is parsed, checked against its schema and then validated by the job", () => {
  const job = { schema, validate: (output: { answer: number }) => (output.answer > 10 ? ["answer too big"] : []) };
  deepStrictEqual(finishOutput(job, { answer: 3 }), { ok: true, output: { answer: 3 } });
  const wrongShape = finishOutput(job, { answer: "3" });
  ok(!wrongShape.ok && wrongShape.failure.kind === "invalid_output" && /schema/.test(wrongShape.failure.message));
  const invalid = finishOutput(job, { answer: 30 });
  ok(!invalid.ok && invalid.failure.kind === "invalid_output" && /answer too big/.test(invalid.failure.message));
  const notJson = parseAnswer("I think the answer is 3");
  ok(!notJson.ok && notJson.failure.kind === "invalid_output");
  deepStrictEqual(parseAnswer("{\"answer\":3}"), { ok: true, answer: { answer: 3 } });
});

test("output schemas become strict JSON Schemas without optional properties", () => {
  const document = jsonSchemaOf(z.strictObject({ a: z.string(), b: z.number().nullable() }));
  equal(document["$schema"], undefined);
  equal(document["additionalProperties"], false);
  deepStrictEqual(document["required"], ["a", "b"]);
});

function fakeJob(provider: "claude" | "codex"): AgentJob<{ answer: number }> {
  return {
    kind: "hypothesis", label: "test", prompt: "p", images: [], schema, validate: () => [],
    workspace: { folder: ".", readOnly: [] }, logFile: "log.jsonl",
    choice: { provider, model: null, effort: "low", timeoutMinutes: 1 },
  };
}

test("the pooled runner picks the job's provider and never runs more jobs than its size", async () => {
  let running = 0;
  let peak = 0;
  const calls: string[] = [];
  const adapter = (name: string): AgentRunner => ({
    async run<T>(): Promise<AgentResult<T>> {
      calls.push(name);
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 20));
      running--;
      return { ok: true, output: { answer: 1 } as T, usage: null, durationMs: 20, sessionId: null };
    },
  });
  const runner = new PooledAgentRunner({ claude: adapter("claude"), codex: adapter("codex") }, 2);
  await Promise.all([fakeJob("claude"), fakeJob("codex"), fakeJob("claude"), fakeJob("codex"), fakeJob("claude")].map((job) => runner.run(job)));
  equal(peak, 2);
  deepStrictEqual(calls.filter((name) => name === "claude").length, 3);
  throws(() => new PooledAgentRunner({ claude: adapter("a"), codex: adapter("b") }, 0), /model pool size/);
});

test("the pooled runner asks mayStart when a job gets its place and does not start a job that is told no", async () => {
  let finished = 0;
  const calls: string[] = [];
  const adapter: AgentRunner = {
    async run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
      calls.push(job.label);
      await new Promise((resolve) => setTimeout(resolve, 20));
      finished++;
      return { ok: true, output: { answer: 1 } as T, usage: null, durationMs: 20, sessionId: null };
    },
  };
  const runner = new PooledAgentRunner({ claude: adapter, codex: adapter }, 1);
  // Only the first job may start: the others ask after it finished, when the first one has used what there was.
  const asked: number[] = [];
  const jobs = ["a", "b", "c"].map((label) => ({ ...fakeJob("claude"), label, mayStart: () => { asked.push(finished); return finished === 0; } }));
  const results = await Promise.all(jobs.map((job) => runner.run(job)));
  deepStrictEqual(asked, [0, 1, 1]);
  deepStrictEqual(calls, ["a"]);
  deepStrictEqual(results.map(wasNotStarted), [false, true, true]);
  equal(results[1], notStarted);
});

test("a CLI name resolves to a program Windows starts without a shell, or says what to set", () => {
  const present = (...files: string[]) => (path: string) => files.includes(path);
  const environment = { Path: "C:\\bin;C:\\npm" };
  deepStrictEqual(resolveExecutable("claude", environment, [], "win32", present("C:\\npm\\claude.exe")), { path: "C:\\npm\\claude.exe" });
  deepStrictEqual(resolveExecutable("claude", environment, [], "linux", present()), { path: "claude" });
  deepStrictEqual(resolveExecutable("C:\\tools\\claude.exe", environment, [], "win32", present()), { path: "C:\\tools\\claude.exe" });
  deepStrictEqual(resolveExecutable("claude", environment, [], "win32", present()), { path: "claude" });
  const shim = resolveExecutable("claude", environment, [], "win32", present("C:\\npm\\claude.cmd"));
  ok("problem" in shim && /C:\\npm\\claude\.cmd is a script shim/.test(shim.problem) && /agents\.executables/.test(shim.problem));
  const native = join("node_modules", "pkg", "claude.exe");
  deepStrictEqual(resolveExecutable("claude", environment, [native], "win32", present("C:\\npm\\claude.cmd", join("C:\\npm", native))), { path: join("C:\\npm", native) });
  ok("problem" in resolveExecutable("C:\\tools\\claude.cmd", environment, [], "win32", present()));
});

test("one runner, and so one model pool, serves the same agent settings", () => {
  const runners = agentRunners({});
  const settings = resolveAgentSettings(undefined);
  equal(runners(settings), runners(resolveAgentSettings(undefined)));
  ok(runners(settings) !== runners(resolveAgentSettings({ modelPool: 3 })));
});

test("without a profile, hypotheses run on Claude and challenges on Codex", () => {
  const settings = resolveAgentSettings(undefined);
  deepStrictEqual(settings.jobs.hypothesis, { provider: "claude", model: null, effort: "medium", timeoutMinutes: 30 });
  deepStrictEqual(settings.jobs.challenge, { provider: "codex", model: null, effort: "medium", timeoutMinutes: 30 });
  deepStrictEqual([settings.modelPool, settings.runBudgetMinutes, settings.executables], [2, 120, { claude: "claude", codex: null }]);
  const configured = resolveAgentSettings({
    jobs: { challenge: { provider: "claude", model: "sonnet" } }, modelPool: 3, runBudgetMinutes: 10, executables: { claude: "c.exe" },
  });
  deepStrictEqual(configured.jobs.challenge, { provider: "claude", model: "sonnet", effort: "medium", timeoutMinutes: 30 });
  deepStrictEqual([configured.modelPool, configured.runBudgetMinutes, configured.executables], [3, 10, { claude: "c.exe", codex: null }]);
});

test("the profile's agents part is validated strictly", () => {
  const path = join(mkdtempSync(join(tmpdir(), "workflow-agents-")), "profile.json");
  writeFileSync(path, JSON.stringify({ agents: { jobs: { hypothesis: { provider: "codex", effort: "high" } }, modelPool: 1 } }));
  deepStrictEqual(loadProfile({ PARITY_WORKFLOW_PROFILE: path }).agents, { jobs: { hypothesis: { provider: "codex", effort: "high" } }, modelPool: 1 });
  for (const agents of [
    { jobs: { challenge: { provider: "other" } } },
    { jobs: { review: { provider: "claude" } } },
    { jobs: { hypothesis: { provider: "claude", effort: "extreme" } } },
    { modelPool: 0 },
    { runBudgetMinutes: -1 },
    // A timer above 2^31-1 ms would fire at once.
    { jobs: { hypothesis: { provider: "claude", timeoutMinutes: 100_000 } } },
  ]) {
    writeFileSync(path, JSON.stringify({ agents }));
    throws(() => loadProfile({ PARITY_WORKFLOW_PROFILE: path }), (error: Error) => error instanceof SetupError && error.message.includes(path), JSON.stringify(agents));
  }
});
