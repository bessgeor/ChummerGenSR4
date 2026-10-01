import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import type { AgentJob, AgentResult } from "../src/agents/agent-job.js";
import { ClaudeAdapter, claudeArguments } from "../src/agents/claude-adapter.js";
import { SetupError } from "../src/host/setup-error.js";
import { fakeSpawn, stopFake, type Script } from "./fake-process.js";

const schema = z.strictObject({ answer: z.number() });
type Answer = z.infer<typeof schema>;

function job(overrides: Partial<AgentJob<Answer>> = {}): AgentJob<Answer> {
  const folder = mkdtempSync(join(tmpdir(), "workflow-claude-"));
  return {
    kind: "hypothesis", label: "hypothesis d-1", prompt: "What is the answer?", images: [], schema,
    validate: (output) => (output.answer < 0 ? ["negative"] : []),
    workspace: { folder, readOnly: ["C:/snapshot/source"] },
    choice: { provider: "claude", model: "sonnet", effort: "high", timeoutMinutes: 1 },
    logFile: join(folder, "logs", "claude.jsonl"),
    ...overrides,
  };
}

const init = (apiKeySource = "none") => JSON.stringify({ type: "system", subtype: "init", session_id: "s-1", apiKeySource });
const result = (fields: Record<string, unknown>) => JSON.stringify({
  type: "result", subtype: "success", is_error: false, total_cost_usd: 0.02,
  usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 50 }, ...fields,
});

async function runWith(scripts: Script[], environment: NodeJS.ProcessEnv = {}, given = job()) {
  const fake = fakeSpawn(scripts);
  let now = 0;
  const adapter = new ClaudeAdapter("C:/tools/claude.exe", environment, fake.spawn, stopFake, () => (now += 1000));
  return { result: await adapter.run(given), calls: fake.calls, job: given };
}

function failureOf(result: AgentResult<Answer>) {
  if (result.ok) throw new Error("expected a failure");
  return result.failure;
}

test("the CLI runs headless with the schema, read-only tools, no MCP, settings or session, in the job folder", async () => {
  const { result: outcome, calls, job: given } = await runWith([{ lines: [init(), result({ structured_output: { answer: 42 } })], code: 0 }],
    { PATH: "p", ANTHROPIC_API_KEY: "secret", anthropic_auth_token: "t", CLAUDE_CODE_USE_BEDROCK: "1" });
  deepStrictEqual(outcome, {
    ok: true, output: { answer: 42 }, sessionId: "s-1", durationMs: 1000,
    usage: { inputTokens: 1110, cachedInputTokens: 1000, outputTokens: 50, costUsd: 0.02 },
  });
  const call = calls[0]!;
  equal(call.command, "C:/tools/claude.exe");
  equal(call.cwd, given.workspace.folder);
  equal(call.input, "What is the answer?");
  deepStrictEqual(call.args, claudeArguments(given));
  deepStrictEqual(call.args.slice(0, 4), ["-p", "--output-format", "stream-json", "--verbose"]);
  const schemaText = call.args[call.args.indexOf("--json-schema") + 1]!;
  deepStrictEqual(JSON.parse(schemaText)["required"], ["answer"]);
  for (const [flag, value] of [["--effort", "high"], ["--model", "sonnet"], ["--permission-mode", "dontAsk"], ["--tools", "Read,Grep,Glob"], ["--add-dir", "C:/snapshot/source"], ["--setting-sources", ""]]) {
    equal(call.args[call.args.indexOf(flag!) + 1], value, flag);
  }
  // A bare tool name in --allowedTools would allow reads of every path, so none is given.
  ok(!call.args.includes("--allowedTools"));
  ok(call.args.includes("--strict-mcp-config") && call.args.includes("--no-session-persistence"));
  deepStrictEqual(call.env, { PATH: "p", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
  ok(readFileSync(given.logFile, "utf8").includes("\"structured_output\""));
});

test("the CLI's default model is used when the choice names none", async () => {
  const given = job({ choice: { provider: "claude", model: null, effort: "low", timeoutMinutes: 1 } });
  ok(!claudeArguments(given).includes("--model"));
});

test("an API-key source other than none stops the job as infra before its answer is used", async () => {
  const { result: outcome } = await runWith([{ lines: [init("ANTHROPIC_API_KEY"), result({ structured_output: { answer: 1 } })], code: 0, hang: true }]);
  const failure = failureOf(outcome);
  equal(failure.kind, "infra");
  ok(/would bill an API key/.test(failure.message));
});

test("error results are classified: usage limit, refusal, structured-output retries and other errors", async () => {
  const limit = await runWith([{ lines: [init(), result({ is_error: true, subtype: "error_during_execution", result: "Claude AI usage limit reached|1790886000" })], code: 1 }]);
  equal(failureOf(limit.result).kind, "quota_exhausted");
  const refusal = await runWith([{ lines: [init(), result({ stop_reason: "refusal", result: "I can't help with that." })], code: 0 }]);
  equal(failureOf(refusal.result).kind, "refused");
  const retries = await runWith([{ lines: [init(), result({ is_error: true, subtype: "error_max_structured_output_retries" })], code: 1 }]);
  equal(failureOf(retries.result).kind, "invalid_output");
  const other = await runWith([{ lines: [init(), result({ is_error: true, subtype: "error_during_execution", result: "Overloaded" })], code: 1 }]);
  equal(failureOf(other.result).kind, "infra");
  ok(other.result.usage !== null);
});

test("a missing or invalid structured output is invalid_output", async () => {
  const missing = await runWith([{ lines: [init(), result({ result: "The answer is 42." })], code: 0 }]);
  equal(failureOf(missing.result).kind, "invalid_output");
  const wrong = await runWith([{ lines: [init(), result({ structured_output: { answer: "42" } })], code: 0 }]);
  equal(failureOf(wrong.result).kind, "invalid_output");
  const rejected = await runWith([{ lines: [init(), result({ structured_output: { answer: -1 } })], code: 0 }]);
  ok(/negative/.test(failureOf(rejected.result).message));
});

test("a CLI that crashes, cannot start or prints a usage limit without a result is classified from its output", async () => {
  const crash = await runWith([{ lines: [init(), "not json"], stderr: "Segmentation fault", code: 3 }]);
  const failure = failureOf(crash.result);
  equal(failure.kind, "infra");
  ok(/exited with 3 without a result/.test(failure.message) && /Segmentation fault/.test(failure.message));
  const missing = await runWith([{ lines: [], code: null, fail: "spawn C:/tools/claude.exe ENOENT" }]);
  ok(/ENOENT/.test(failureOf(missing.result).message));
  const limit = await runWith([{ lines: [], stderr: "You've hit your usage limit", code: 1 }]);
  equal(failureOf(limit.result).kind, "quota_exhausted");
});

test("a job past its time limit is stopped and fails as infra", async () => {
  const given = job({ choice: { provider: "claude", model: null, effort: "low", timeoutMinutes: 0.0005 } });
  const { result: outcome } = await runWith([{ lines: [init()], code: 0, hang: true }], {}, given);
  const failure = failureOf(outcome);
  equal(failure.kind, "infra");
  ok(/longer than 0.0005 minutes/.test(failure.message));
});

test("a stopped run stops the job and is a setup error; an aborted signal starts nothing", async () => {
  const controller = new AbortController();
  const fake = fakeSpawn([{ lines: [init()], code: 0, hang: true }]);
  const adapter = new ClaudeAdapter("claude", {}, fake.spawn, stopFake);
  const running = adapter.run(job({ signal: controller.signal }));
  setTimeout(() => controller.abort(), 20);
  await rejects(running, SetupError);
  const none = fakeSpawn([]);
  await rejects(new ClaudeAdapter("claude", {}, none.spawn, stopFake).run(job({ signal: AbortSignal.abort() })), SetupError);
  equal(none.calls.length, 0);
});

test("the job's log folder is created", async () => {
  const given = job();
  await runWith([{ lines: [init(), result({ structured_output: { answer: 1 } })], code: 0 }], {}, given);
  ok(existsSync(given.logFile));
});

test("usage is null when the result lacks a count, never zero tokens", async () => {
  const truncated = await runWith([{ lines: [init(), result({ structured_output: { answer: 1 }, usage: { input_tokens: 10, output_tokens: 5 } })], code: 0 }]);
  ok(truncated.result.ok);
  equal(truncated.result.usage, null);
  const none = await runWith([{ lines: [init(), result({ structured_output: { answer: 1 }, usage: undefined })], code: 0 }]);
  equal(none.result.usage, null);
});

test("an HTTP status of 429 is a usage limit, a refused connection is not a refusal", async () => {
  const limited = await runWith([{ lines: [init(), result({ is_error: true, subtype: "error_during_execution", result: "Too many requests", api_error_status: 429 })], code: 1 }]);
  equal(failureOf(limited.result).kind, "quota_exhausted");
  const offline = await runWith([{ lines: [], stderr: "connect ECONNREFUSED 127.0.0.1:8080: Connection refused", code: 1 }]);
  equal(failureOf(offline.result).kind, "infra");
});

test("a CLI that only exists as a script shim fails as infra with what to set, before any process starts", async () => {
  const fake = fakeSpawn([]);
  const adapter = new ClaudeAdapter("claude", {}, fake.spawn, stopFake, undefined, () => ({ problem: "claude.cmd is a script shim" }));
  const failure = failureOf(await adapter.run(job()));
  equal(failure.kind, "infra");
  ok(/script shim/.test(failure.message));
  equal(fake.calls.length, 0);
});

test("the resolved program is the one that starts", async () => {
  const fake = fakeSpawn([{ lines: [init(), result({ structured_output: { answer: 1 } })], code: 0 }]);
  const adapter = new ClaudeAdapter("claude", {}, fake.spawn, stopFake, undefined, () => ({ path: "C:/found/claude.exe" }));
  ok((await adapter.run(job())).ok);
  equal(fake.calls[0]!.command, "C:/found/claude.exe");
});
