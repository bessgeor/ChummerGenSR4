import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CodexOptions, Input, ThreadEvent, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import { z } from "zod";
import type { AgentJob, AgentResult } from "../src/agents/agent-job.js";
import { CodexAdapter, codexConfig, type CodexClientFactory } from "../src/agents/codex-adapter.js";
import { SetupError } from "../src/host/setup-error.js";

const schema = z.strictObject({ answer: z.number() });
type Answer = z.infer<typeof schema>;

function codexHome(mode: string | null): string {
  const home = mkdtempSync(join(tmpdir(), "workflow-codex-home-"));
  if (mode !== null) writeFileSync(join(home, "auth.json"), JSON.stringify({ auth_mode: mode, OPENAI_API_KEY: null, tokens: {} }));
  return home;
}

function job(overrides: Partial<AgentJob<Answer>> = {}): AgentJob<Answer> {
  const folder = mkdtempSync(join(tmpdir(), "workflow-codex-"));
  mkdirSync(join(folder, "evidence"));
  return {
    kind: "challenge", label: "challenge d-1", prompt: "Challenge it.", images: [join(folder, "evidence", "canonical.png")], schema,
    validate: (output) => (output.answer < 0 ? ["negative"] : []),
    workspace: { folder, readOnly: [] },
    choice: { provider: "codex", model: "gpt-x", effort: "high", timeoutMinutes: 1 },
    logFile: join(folder, "codex.jsonl"),
    ...overrides,
  };
}

type Recorded = { client?: CodexOptions; thread?: ThreadOptions; input?: Input; turn?: TurnOptions };

/** A client whose turn yields the given events; `hang` keeps the stream open until the signal aborts. */
function fakeClient(events: ThreadEvent[], recorded: Recorded, options: { hang?: boolean; throws?: string } = {}): CodexClientFactory {
  return (clientOptions) => {
    recorded.client = clientOptions;
    return {
      startThread(threadOptions) {
        recorded.thread = threadOptions;
        return {
          async runStreamed(input, turnOptions) {
            recorded.input = input;
            recorded.turn = turnOptions;
            async function* stream(): AsyncGenerator<ThreadEvent> {
              for (const event of events) yield event;
              if (options.throws !== undefined) throw new Error(options.throws);
              if (options.hang === true) {
                await new Promise((_resolve, reject) => turnOptions.signal?.addEventListener("abort", () => reject(new Error("aborted"))));
              }
            }
            return { events: stream() };
          },
        };
      },
    };
  };
}

const usage = { input_tokens: 100, cached_input_tokens: 40, cache_write_input_tokens: 0, output_tokens: 20, reasoning_output_tokens: 5 };
const answered = (text: string): ThreadEvent[] => [
  { type: "thread.started", thread_id: "t-1" },
  { type: "turn.started" },
  { type: "item.completed", item: { id: "i", type: "agent_message", text } },
  { type: "turn.completed", usage },
];

async function runWith(events: ThreadEvent[], environment: NodeJS.ProcessEnv, given = job(), options: { hang?: boolean; throws?: string } = {}) {
  const recorded: Recorded = {};
  const adapter = new CodexAdapter("C:/tools/codex.exe", environment, fakeClient(events, recorded, options));
  return { result: await adapter.run(given), recorded, job: given };
}

function failureOf(result: AgentResult<Answer>) {
  if (result.ok) throw new Error("expected a failure");
  return result.failure;
}

test("a job runs read-only without approvals, web search, network, API keys or repository instructions", async () => {
  const home = codexHome("chatgpt");
  const { result, recorded, job: given } = await runWith(answered("{\"answer\":7}"), { CODEX_HOME: home, PATH: "p", OPENAI_API_KEY: "k", codex_api_key: "c" });
  ok(result.ok);
  deepStrictEqual(result.output, { answer: 7 });
  equal(result.sessionId, "t-1");
  deepStrictEqual(result.usage, { inputTokens: 100, cachedInputTokens: 40, outputTokens: 20, costUsd: null });
  deepStrictEqual(recorded.client, { env: { CODEX_HOME: home, PATH: "p" }, config: codexConfig, codexPathOverride: "C:/tools/codex.exe" });
  deepStrictEqual(recorded.thread, {
    workingDirectory: given.workspace.folder, model: "gpt-x", modelReasoningEffort: "high", sandboxMode: "read-only",
    approvalPolicy: "never", webSearchMode: "disabled", networkAccessEnabled: false, skipGitRepoCheck: true,
  });
  deepStrictEqual(recorded.input, [{ type: "text", text: "Challenge it." }, { type: "local_image", path: given.images[0] }]);
  deepStrictEqual((recorded.turn?.outputSchema as { required: string[] }).required, ["answer"]);
  ok(readFileSync(given.logFile, "utf8").includes("\"agent_message\""));
});

test("the CLI's default model and the SDK's own CLI are used when none is chosen", async () => {
  const recorded: Recorded = {};
  const adapter = new CodexAdapter(null, { CODEX_HOME: codexHome("chatgpt") }, fakeClient(answered("{\"answer\":1}"), recorded));
  ok((await adapter.run(job({ choice: { provider: "codex", model: null, effort: "low", timeoutMinutes: 1 } }))).ok);
  equal(recorded.thread?.model, undefined);
  equal(recorded.client?.codexPathOverride, undefined);
});

test("a sign-in that is not the ChatGPT subscription, or none, fails as infra before Codex starts", async () => {
  for (const home of [codexHome("apikey"), codexHome(null)]) {
    const recorded: Recorded = {};
    const adapter = new CodexAdapter(null, { CODEX_HOME: home }, fakeClient(answered("{\"answer\":1}"), recorded));
    const failure = failureOf(await adapter.run(job()));
    equal(failure.kind, "infra");
    equal(recorded.client, undefined);
  }
});

test("failed turns are classified: usage limit and other errors; a thrown stream error too", async () => {
  const environment = { CODEX_HOME: codexHome("chatgpt") };
  const limit = await runWith([{ type: "thread.started", thread_id: "t" }, { type: "turn.failed", error: { message: "You've hit your usage limit. Try again in 3 hours." } }], environment);
  equal(failureOf(limit.result).kind, "quota_exhausted");
  const error = await runWith([{ type: "error", message: "stream disconnected before completion" }], environment);
  equal(failureOf(error.result).kind, "infra");
  const thrown = await runWith([], environment, job(), { throws: "Codex Exec exited with code 1: usage_limit_reached" });
  equal(failureOf(thrown.result).kind, "quota_exhausted");
  // The SDK throws the CLI's exit error after the failed turn; it must not replace the turn's own message.
  const afterTurn = await runWith([{ type: "turn.failed", error: { message: "You've hit your usage limit. Try again in 3 hours." } }], environment, job(),
    { throws: "Codex Exec exited with code 1: see the log" });
  equal(failureOf(afterTurn.result).kind, "quota_exhausted");
  const afterStreamError = await runWith([{ type: "error", message: "stream disconnected" }, { type: "turn.failed", error: { message: "You've hit your usage limit." } }], environment);
  equal(failureOf(afterStreamError.result).kind, "quota_exhausted");
});

test("a file change, MCP tool call or web search stops the job as infra; read commands are allowed", async () => {
  const environment = { CODEX_HOME: codexHome("chatgpt") };
  const change = await runWith([{ type: "item.started", item: { id: "f", type: "file_change", changes: [], status: "completed" } }], environment, job(), { hang: true });
  ok(/file_change/.test(failureOf(change.result).message));
  const tool = await runWith([{ type: "item.started", item: { id: "m", type: "mcp_tool_call", server: "s", tool: "t", arguments: {}, status: "in_progress" } }], environment);
  equal(failureOf(tool.result).kind, "infra");
  const search = await runWith([{ type: "item.completed", item: { id: "w", type: "web_search", query: "q" } }], environment);
  equal(failureOf(search.result).kind, "infra");
  const read = await runWith([
    { type: "item.completed", item: { id: "c", type: "command_execution", command: "Get-Content a.txt", aggregated_output: "42", exit_code: 0, status: "completed" } },
    ...answered("{\"answer\":42}"),
  ], environment);
  ok(read.result.ok);
});

test("an answer that is no JSON, does not match the schema or fails validation is invalid_output; no answer too", async () => {
  const environment = { CODEX_HOME: codexHome("chatgpt") };
  for (const text of ["the answer is 7", "{\"answer\":\"7\"}", "{\"answer\":-7}"]) {
    equal(failureOf((await runWith(answered(text), environment)).result).kind, "invalid_output", text);
  }
  const silent = await runWith([{ type: "turn.completed", usage }], environment);
  equal(failureOf(silent.result).kind, "invalid_output");
});

test("a job past its time limit fails as infra; a stopped run is a setup error", async () => {
  const environment = { CODEX_HOME: codexHome("chatgpt") };
  const timeout = await runWith([], environment, job({ choice: { provider: "codex", model: null, effort: "low", timeoutMinutes: 0.0005 } }), { hang: true });
  ok(/longer than 0.0005 minutes/.test(failureOf(timeout.result).message));
  const controller = new AbortController();
  const adapter = new CodexAdapter(null, environment, fakeClient([], {}, { hang: true }));
  const running = adapter.run(job({ signal: controller.signal }));
  setTimeout(() => controller.abort(), 20);
  await rejects(running, SetupError);
  await rejects(adapter.run(job({ signal: AbortSignal.abort() })), SetupError);
});
