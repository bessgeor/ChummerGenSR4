import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";
import { killTree } from "../host/host-runner.js";
import { SetupError } from "../host/setup-error.js";
import type { AgentFailure, AgentJob, AgentResult, AgentRunner, AgentUsage } from "./agent-job.js";
import { JobLog } from "./job-log.js";
import { childEnvironment } from "./child-environment.js";
import { claudeNativeBesideShim, resolveExecutable, type ResolvedExecutable } from "./executable.js";
import { classifyFailure, failure, finishOutput, jsonSchemaOf } from "./job-output.js";

/** The only tools a Claude job gets: reading and searching files. */
export const claudeTools = ["Read", "Grep", "Glob"] as const;

/** Variables that would bill a job to an API key or another cloud account instead of the subscription. */
const billingVariables = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX", "CLAUDE_CODE_USE_FOUNDRY"];

export function claudeArguments<T>(job: AgentJob<T>): string[] {
  const args = ["-p", "--output-format", "stream-json", "--verbose",
    "--json-schema", JSON.stringify(jsonSchemaOf(job.schema)), "--effort", job.choice.effort];
  if (job.choice.model !== null) args.push("--model", job.choice.model);
  // No --allowedTools: a bare tool name allows every path. Without it, dontAsk reads only the job folder and the
  // --add-dir folders and denies everything else.
  args.push("--permission-mode", "dontAsk", "--tools", claudeTools.join(","));
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

/** The usage the result reports, or null when it lacks a count: a missing count is not zero tokens. */
function usageOf(result: ResultEvent): AgentUsage | null {
  const usage = result.usage;
  if (usage === undefined) return null;
  const { input_tokens: input, cache_creation_input_tokens: created, cache_read_input_tokens: cached, output_tokens: output } = usage;
  if (input === undefined || created === undefined || cached === undefined || output === undefined) return null;
  return { inputTokens: input + created + cached, cachedInputTokens: cached, outputTokens: output, costUsd: result.total_cost_usd ?? null };
}

function parseEvent(line: string): Record<string, unknown> | null {
  if (!line.startsWith("{")) return null;
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The prompt, followed by the images the model is shown: the CLI is given text only, so the model opens them with Read. */
export function promptWithImages<T>(job: AgentJob<T>): string {
  if (job.images.length === 0) return job.prompt;
  return `${job.prompt}\n\nEvidence images: before you answer, open each of these with the Read tool and look at it.\n${job.images.map((image) => `- ${image}`).join("\n")}\n`;
}

type ContentBlock = { type?: string; id?: string; name?: string; input?: { file_path?: unknown }; tool_use_id?: string; is_error?: boolean };

function contentOf(event: Record<string, unknown>): ContentBlock[] {
  const content = (event["message"] as { content?: unknown } | undefined)?.content;
  return Array.isArray(content) ? content as ContentBlock[] : [];
}

/** The Read requests of an assistant event: the tool call ID with the absolute, lower-case path. */
function readRequests(event: Record<string, unknown>, folder: string): [string, string][] {
  return contentOf(event).flatMap((block) => block.type === "tool_use" && block.name === "Read" && block.id !== undefined && typeof block.input?.file_path === "string"
    ? [[block.id, resolve(folder, block.input.file_path).toLowerCase()] as [string, string]] : []);
}

/** The IDs of the tool calls a user event answers without an error: a request that failed did not show the model its file. */
function succeededCalls(event: Record<string, unknown>): string[] {
  return contentOf(event).flatMap((block) => (block.type === "tool_result" && block.tool_use_id !== undefined && block.is_error !== true ? [block.tool_use_id] : []));
}

/** How a run of the CLI ended, before its answer is judged. */
type Ending = { result: ResultEvent | null; guard: AgentFailure | null; timedOut: boolean; code: number | null; stderr: string; diagnostics: string[]; read: string[] };

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
    private readonly resolve: (executable: string, environment: NodeJS.ProcessEnv) => ResolvedExecutable =
      (executable, environment) => resolveExecutable(executable, environment, claudeNativeBesideShim),
  ) {}

  async run<T>(job: AgentJob<T>): Promise<AgentResult<T>> {
    const started = this.clock();
    const program = this.resolve(this.executable, this.environment);
    if ("problem" in program) {
      return { ok: false, failure: failure("infra", `${job.label}: the Claude CLI cannot be started: ${program.problem}`), usage: null, durationMs: this.clock() - started, sessionId: null };
    }
    const ending = await this.execute(job, program.path);
    const durationMs = this.clock() - started;
    const sessionId = ending.sessionId;
    const usage = ending.result === null ? null : usageOf(ending.result);
    const failed = (value: AgentFailure): AgentResult<T> => ({ ok: false, failure: value, usage, durationMs, sessionId });
    if (ending.guard !== null) return failed(ending.guard);
    if (ending.timedOut) return failed(failure("infra", `${job.label}: the Claude job ran longer than ${job.choice.timeoutMinutes} minutes and was stopped.`));
    const result = ending.result;
    if (result === null) {
      // The CLI's own words only: stderr, stdout lines that are no events, and error events. Model text and file contents are not.
      const text = `${ending.stderr}\n${ending.diagnostics.join("\n")}`.trim();
      return failed(failure(classifyFailure(text), `${job.label}: claude exited with ${ending.code} without a result: ${text}`));
    }
    if (result.subtype?.startsWith("error_max_structured_output") === true) {
      return failed(failure("invalid_output", `${job.label}: the model gave no answer that matches the schema (${result.subtype}).`));
    }
    if (result.stop_reason === "refusal") return failed(failure("refused", `${job.label}: ${result.result ?? "the model refused"}`));
    if (result.is_error === true) {
      const text = `${result.result ?? ""} (${result.subtype ?? "error"}, status ${result.api_error_status ?? "none"})`;
      return failed(failure(classifyFailure(text, result.api_error_status ?? null), `${job.label}: ${text}`));
    }
    // The Codex adapter attaches the crops; Claude has to open them, so both providers work from the same evidence.
    const unseen = job.images.filter((image) => !ending.read.includes(resolve(image).toLowerCase()));
    if (unseen.length > 0) {
      return failed(failure("invalid_output", `${job.label}: the model answered without a successful Read of ${unseen.length} of ${job.images.length} evidence images (${unseen.join(", ")}).`));
    }
    if (result.structured_output === undefined) {
      return failed(failure("invalid_output", `${job.label}: the result has no structured output: ${(result.result ?? "").slice(0, 500)}`));
    }
    const finished = finishOutput(job, result.structured_output);
    return finished.ok ? { ok: true, output: finished.output, usage, durationMs, sessionId } : failed(finished.failure);
  }

  private execute<T>(job: AgentJob<T>, program: string): Promise<Ending & { sessionId: string | null }> {
    return new Promise((resolve, reject) => {
      if (job.signal?.aborted === true) {
        reject(new SetupError(`${job.label}: not started because the run was stopped.`));
        return;
      }
      // A log that cannot be written stops the job; closing it then throws a setup error.
      const log = new JobLog(job.logFile, job.label, () => this.stop(child));
      const env = childEnvironment(this.environment, billingVariables, { CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" });
      const child = this.spawnProcess(program, claudeArguments(job),
        { cwd: job.workspace.folder, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
      const state: Ending & { sessionId: string | null } = { result: null, guard: null, timedOut: false, code: null, stderr: "", diagnostics: [], read: [], sessionId: null };
      let aborted = false;
      let pending = "";
      const requested = new Map<string, string>();
      const onLine = (line: string) => {
        const event = parseEvent(line);
        if (event === null) {
          if (line.trim().length > 0) state.diagnostics.push(line);
          if (state.diagnostics.length > 20) state.diagnostics.shift();
          return;
        }
        if (event["type"] === "system" && event["subtype"] === "init") {
          state.sessionId = typeof event["session_id"] === "string" ? event["session_id"] : null;
          if (event["apiKeySource"] !== "none") {
            state.guard = failure("infra", `${job.label}: the Claude CLI would bill an API key (apiKeySource ${String(event["apiKeySource"])}); sign in with the subscription instead.`);
            this.stop(child);
          }
        } else if (event["type"] === "result") {
          state.result = event as ResultEvent;
        } else if (event["type"] === "assistant") {
          for (const [id, path] of readRequests(event, job.workspace.folder)) requested.set(id, path);
        } else if (event["type"] === "user") {
          // A path counts as opened when its Read call got a result that is no error.
          for (const id of succeededCalls(event)) {
            const path = requested.get(id);
            if (path !== undefined) state.read.push(path);
          }
        } else if (event["type"] === "error") {
          state.diagnostics.push(JSON.stringify(event["error"] ?? event["message"] ?? event));
          if (state.diagnostics.length > 20) state.diagnostics.shift();
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
        state.code = code;
        // The log is complete before the job's result is used.
        log.close().then(() => {
          if (aborted) reject(new SetupError(`${job.label}: the Claude job was stopped because the run was stopped.`));
          else resolve(state);
        }, reject);
      };
      // A CLI that cannot start reports an error and may never close.
      child.on("error", (error) => {
        state.stderr = `${state.stderr}${error.message}`;
        settle(null);
      });
      child.on("close", (code) => settle(code));
      child.stdin?.on("error", () => undefined).end(promptWithImages(job));
    });
  }
}
