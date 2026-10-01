import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { killTree } from "../host/host-runner.js";
import { SetupError } from "../host/setup-error.js";
import type { AgentFailure, AgentJob, AgentResult, AgentRunner, AgentUsage } from "./agent-job.js";
import { childEnvironment } from "./child-environment.js";
import { classifyFailure, failure, finishOutput, jsonSchemaOf } from "./job-output.js";

/** The only tools a Claude job gets: reading and searching files. */
export const claudeTools = ["Read", "Grep", "Glob"] as const;

/** Variables that would bill a job to an API key or another cloud account instead of the subscription. */
const billingVariables = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

export function claudeArguments<T>(job: AgentJob<T>): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose",
    "--json-schema", JSON.stringify(jsonSchemaOf(job.schema)), "--effort", job.choice.effort];
  if (job.choice.model !== null) args.push("--model", job.choice.model);
  args.push("--permission-mode", "dontAsk", "--tools", claudeTools.join(","), "--allowedTools", ...claudeTools);
  for (const folder of job.workspace.readOnly) args.push("--add-dir", folder);
  args.push("--strict-mcp-config", "--no-session-persistence", "--setting-sources", "");
  return args;
}

type ResultEvent = {
  type: "result";
  subtype?: string;
  is_error?: boolean;
  result?: string;
  stop_reason?: string | null;
  api_error_status?: number | null;
  structured_output?: unknown;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number; output_tokens?: number };
};

function usageOf(result: ResultEvent): AgentUsage | null {
  const usage = result.usage;
  if (usage === undefined) return null;
  const cached = usage.cache_read_input_tokens ?? 0;
  return {
    inputTokens: (usage.input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0) + cached,
    cachedInputTokens: cached,
    outputTokens: usage.output_tokens ?? 0,
    costUsd: result.total_cost_usd ?? null,
  };
}

function parseEvent(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** How a run of the CLI ended, before its answer is judged. */
type Ending = { result: ResultEvent | null; guard: AgentFailure | null; timedOut: boolean; code: number | null; stderr: string; tail: string[] };

/**
 * Runs a job with the Claude Code CLI in headless mode, under the user's Claude subscription: read-only tools,
 * no MCP servers, no settings or saved session, and the job folder as working directory.
 */
export class ClaudeAdapter implements AgentRunner {
  constructor(
    private readonly executable: string,
    private readonly environment: NodeJS.ProcessEnv,
    private readonly spawnProcess: typeof spawn = spawn,
    private readonly stop: (child: ChildProcess) => void = killTree,
    private readonly clock: () => number = Date.now,
  ) {}

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
    const started = this.clock();
    const ending = await this.execute(job);
    const durationMs = this.clock() - started;
    const sessionId = ending.sessionId;
    const usage = ending.result === null ? null : usageOf(ending.result);
    const failed = (value: AgentFailure): AgentResult<T> => ({ ok: false, failure: value, usage, durationMs, sessionId });
    if (ending.guard !== null) return failed(ending.guard);
    if (ending.timedOut) return failed(failure("infra", `${job.label}: the Claude job ran longer than ${job.choice.timeoutMinutes} minutes and was stopped.`));
    const result = ending.result;
    if (result === null) {
      const text = `${ending.stderr}\n${ending.tail.join("\n")}`.trim();
      return failed(failure(classifyFailure(text), `${job.label}: claude exited with ${ending.code} without a result: ${text}`));
    }
    if (result.subtype?.startsWith("error_max_structured_output") === true) {
      return failed(failure("invalid_output", `${job.label}: the model gave no answer that matches the schema (${result.subtype}).`));
    }
    if (result.stop_reason === "refusal") return failed(failure("refused", `${job.label}: ${result.result ?? "the model refused"}`));
    if (result.is_error === true) {
      const text = `${result.result ?? ""} (${result.subtype ?? "error"}, status ${result.api_error_status ?? "none"})`;
      return failed(failure(classifyFailure(text), `${job.label}: ${text}`));
    }
    if (result.structured_output === undefined) {
      return failed(failure("invalid_output", `${job.label}: the result has no structured output: ${(result.result ?? "").slice(0, 500)}`));
    }
    const finished = finishOutput(job, result.structured_output);
    return finished.ok ? { ok: true, output: finished.output, usage, durationMs, sessionId } : failed(finished.failure);
  }

  private execute<T>(job: AgentJob<T>): Promise<Ending & { sessionId: string | null }> {
    return new Promise((resolve, reject) => {
      if (job.signal?.aborted === true) {
        reject(new SetupError(`${job.label}: not started because the run was stopped.`));
        return;
      }
      mkdirSync(dirname(job.logFile), { recursive: true });
      const log = createWriteStream(job.logFile);
      const env = childEnvironment(this.environment, billingVariables, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
      const child = this.spawnProcess(this.executable, claudeArguments(job),
        { cwd: job.workspace.folder, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      const state: Ending & { sessionId: string | null } = { result: null, guard: null, timedOut: false, code: null, stderr: "", tail: [], sessionId: null };
      let aborted = false;
      let pending = "";
      const onLine = (line: string) => {
        state.tail.push(line);
        if (state.tail.length > 20) state.tail.shift();
        const event = parseEvent(line);
        if (event === null) return;
        if (event["type"] === "system" && event["subtype"] === "init") {
          state.sessionId = typeof event["session_id"] === "string" ? event["session_id"] : null;
          if (event["apiKeySource"] !== "none") {
            state.guard = failure("infra", `${job.label}: the Claude CLI would bill an API key (apiKeySource ${String(event["apiKeySource"])}); sign in with the subscription instead.`);
            this.stop(child);
          }
        } else if (event["type"] === "result") {
          state.result = event as ResultEvent;
        }
      };
      child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
        log.write(chunk);
        const lines = (pending + chunk).split(/\r?\n/);
        pending = lines.pop() ?? "";
        for (const line of lines) onLine(line);
      });
      child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
        state.stderr = (state.stderr + chunk).slice(-4000);
      });
      const timer = setTimeout(() => {
        state.timedOut = true;
        this.stop(child);
      }, job.choice.timeoutMinutes * 60_000);
      const abort = () => {
        aborted = true;
        this.stop(child);
      };
      job.signal?.addEventListener("abort", abort, { once: true });
      let settled = false;
      const settle = (code: number | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        job.signal?.removeEventListener("abort", abort);
        if (pending.length > 0) onLine(pending);
        log.end();
        state.code = code;
        if (aborted) reject(new SetupError(`${job.label}: the Claude job was stopped because the run was stopped.`));
        else resolve(state);
      };
      // A CLI that cannot start reports an error and may never close.
      child.on("error", (error) => {
        state.stderr = `${state.stderr}${error.message}`;
        settle(null);
      });
      child.on("close", (code) => settle(code));
      child.stdin?.on("error", () => undefined).end(job.prompt);
    });
  }
}
