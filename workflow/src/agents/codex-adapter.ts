import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Codex, type CodexOptions, type Input, type ThreadEvent, type ThreadOptions, type TurnOptions, type Usage } from "@openai/codex-sdk";
import { SetupError } from "../host/setup-error.js";
import type { AgentFailure, AgentJob, AgentResult, AgentRunner, AgentUsage } from "./agent-job.js";
import { JobLog } from "./job-log.js";
import { childEnvironment } from "./child-environment.js";
import { classifyFailure, failure, finishOutput, jsonSchemaOf, parseAnswer } from "./job-output.js";

/** The part of the Codex SDK the adapter uses, so tests can stand in for it. */
export type CodexClient = {
  startThread(options: ThreadOptions): { runStreamed(input: Input, options: TurnOptions): Promise<{ events: AsyncGenerator<ThreadEvent> }> };
};
export type CodexClientFactory = (options: CodexOptions) => CodexClient;

/** Variables that would bill a job to an API key instead of the ChatGPT subscription. */
const billingVariables = ["OPENAI_API_KEY", "CODEX_API_KEY"];

/** Repository instruction files (AGENTS.md) must not enter a job's sealed context. */
export const codexConfig = { project_doc_max_bytes: 0 } as const;

export function codexThreadOptions<T>(job: AgentJob<T>): ThreadOptions {
  return {
    workingDirectory: job.workspace.folder,
    ...(job.choice.model === null ? {} : { model: job.choice.model }),
    modelReasoningEffort: job.choice.effort,
    sandboxMode: "read-only",
    approvalPolicy: "never",
    webSearchMode: "disabled",
    networkAccessEnabled: false,
    skipGitRepoCheck: true,
  };
}

/** Why the Codex sign-in cannot run a job under the subscription, or null when it can. */
export function signInProblem(environment: NodeJS.ProcessEnv): string | null {
  const home = environment["CODEX_HOME"] ?? join(homedir(), ".codex");
  const path = join(home, "auth.json");
  if (!existsSync(path)) return `Codex is not signed in (${path} does not exist); run codex login with the ChatGPT subscription.`;
  let mode: unknown;
  try {
    mode = (JSON.parse(readFileSync(path, "utf8")) as { auth_mode?: unknown }).auth_mode;
  } catch (error) {
    return `The Codex sign-in ${path} cannot be read: ${(error as Error).message}`;
  }
  return mode === "chatgpt" ? null : `Codex is signed in with ${String(mode)}, which would bill an API key; sign in with the ChatGPT subscription.`;
}

function usageOf(usage: Usage): AgentUsage {
  return { inputTokens: usage.input_tokens, cachedInputTokens: usage.cached_input_tokens, outputTokens: usage.output_tokens, costUsd: null };
}

/**
 * Runs a job with the Codex SDK under the user's ChatGPT subscription: a read-only sandbox, no approvals, no web
 * search, no network for commands, and the job folder as working directory. The sandbox limits writes, not reads,
 * so the caller must give the job a working folder that has nothing else of value around it.
 */
export class CodexAdapter implements AgentRunner {
  constructor(
    private readonly executable: string | null,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly createClient: CodexClientFactory = (options) => new Codex(options),
    private readonly clock: () => number = Date.now,
  ) {}

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
    if (job.signal?.aborted === true) throw new SetupError(`${job.label}: not started because the run was stopped.`);
    const started = this.clock();
    let sessionId: string | null = null;
    let usage: AgentUsage | null = null;
    const failed = (value: AgentFailure): AgentResult<T> => ({ ok: false, failure: value, usage, durationMs: this.clock() - started, sessionId });
    const problem = signInProblem(this.environment);
    if (problem !== null) return failed(failure("infra", `${job.label}: ${problem}`));

    const client = this.createClient({
      env: childEnvironment(this.environment, billingVariables), config: codexConfig,
      ...(this.executable === null ? {} : { codexPathOverride: this.executable }),
    });
    const controller = new AbortController();
    // A log that cannot be written stops the job; closing it then throws a setup error. It is made before the timer, so a failure leaves nothing running.
    const log = new JobLog(job.logFile, job.label, () => controller.abort());
    // Set by the timer and the run's signal, which TypeScript's narrowing does not see.
    let stopped = null as "timeout" | "run" | null;
    let guard: AgentFailure | null = null;
    const timer = setTimeout(() => {
      stopped = "timeout";
      controller.abort();
    }, job.choice.timeoutMinutes * 60_000);
    const abort = () => {
      stopped = "run";
      controller.abort();
    };
    job.signal?.addEventListener("abort", abort, { once: true });
    let answer: string | null = null;
    // The failed turn's own message comes first; a stream error or the SDK's exit error after it is only a fallback.
    let failedTurn: string | null = null;
    let streamFailure: string | null = null;
    try {
      const input: Input = [{ type: "text", text: job.prompt }, ...job.images.map((path) => ({ type: "local_image" as const, path }))];
      const turn = await client.startThread(codexThreadOptions(job)).runStreamed(input, { outputSchema: jsonSchemaOf(job.schema), signal: controller.signal });
      for await (const event of turn.events) {
        log.write(`${JSON.stringify(event)}\n`);
        if (event.type === "thread.started") {
          sessionId = event.thread_id;
        } else if (event.type === "turn.completed") {
          usage = usageOf(event.usage);
        } else if (event.type === "turn.failed") {
          failedTurn ??= event.error.message;
        } else if (event.type === "error") {
          streamFailure ??= event.message;
        } else if (event.type !== "turn.started") {
          const item = event.item;
          // Codex reads files with commands, which the read-only sandbox keeps from writing or reaching the network.
          if (item.type === "file_change" || item.type === "mcp_tool_call" || item.type === "web_search") {
            guard = failure("infra", `${job.label}: Codex used ${item.type}, which a read-only job must not.`);
            controller.abort();
            break;
          }
          if (event.type === "item.completed" && item.type === "agent_message") answer = item.text;
        }
      }
    } catch (error) {
      // The SDK throws the CLI's exit error after a failed turn.
      if (stopped === null && guard === null) streamFailure ??= (error as Error).message;
    } finally {
      clearTimeout(timer);
      job.signal?.removeEventListener("abort", abort);
      await log.close();
    }

    if (stopped === "run") throw new SetupError(`${job.label}: the Codex job was stopped because the run was stopped.`);
    if (guard !== null) return failed(guard);
    if (stopped === "timeout") return failed(failure("infra", `${job.label}: the Codex job ran longer than ${job.choice.timeoutMinutes} minutes and was stopped.`));
    const turnFailure = failedTurn ?? streamFailure;
    if (turnFailure !== null) return failed(failure(classifyFailure(turnFailure), `${job.label}: ${turnFailure}`));
    if (answer === null) return failed(failure("invalid_output", `${job.label}: the Codex turn ended without an answer.`));
    const parsed = parseAnswer(answer);
    if (!parsed.ok) return failed(parsed.failure);
    const finished = finishOutput(job, parsed.answer);
    return finished.ok ? { ok: true, output: finished.output, usage, durationMs: this.clock() - started, sessionId } : failed(finished.failure);
  }
}
