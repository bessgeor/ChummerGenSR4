import type { AgentRunner } from "./agent-job.js";
import type { AgentSettings } from "./agent-settings.js";
import { ClaudeAdapter } from "./claude-adapter.js";
import { CodexAdapter } from "./codex-adapter.js";
import { PooledAgentRunner } from "./pooled-agent-runner.js";

/** The agent runner for a thread's agent settings. */
export type AgentRunners = (settings: AgentSettings) => AgentRunner;

/** One runner, and so one model pool, per distinct agent settings; a thread keeps the settings it started with. */
export function agentRunners(environment: NodeJS.ProcessEnv): AgentRunners {
  const runners = new Map<string, AgentRunner>();
  return (settings) => {
    const key = JSON.stringify(settings);
    let runner = runners.get(key);
    if (runner === undefined) {
      runner = new PooledAgentRunner({
        claude: new ClaudeAdapter(settings.executables.claude, environment),
        codex: new CodexAdapter(settings.executables.codex, environment),
      }, settings.modelPool);
      runners.set(key, runner);
    }
    return runner;
  };
}
