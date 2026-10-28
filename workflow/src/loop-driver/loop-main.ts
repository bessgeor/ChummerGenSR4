// Command line of the loop: `npm run loop -- <options>` runs workflow threads and automatic tunings one after another
// until nothing changes, and exits with 0, 2 or 3 (see --help).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeWorkflow } from "../compose-workflow.js";
import { composeEvalContext } from "../evals/compose-eval-context.js";
import { setupErrorStatus } from "../graph/run-workflow.js";
import { interruptSignal } from "../host/interrupt-signal.js";
import { SetupError } from "../host/setup-error.js";
import { loadProfile } from "../options/profile.js";
import { workflowPaths } from "../paths.js";
import { loopUsage, parseLoopArguments } from "./loop-arguments.js";
import { loopPaths, newLoopId } from "./loop-document.js";
import { hostLoopSteps, openLoopCheckpointer, runLoop } from "./run-loop.js";

// An unexpected error must not end with Node's status 1.
process.on("uncaughtException", (error) => {
  console.error(`npm run loop failed: ${error.stack ?? String(error)}`);
  process.exit(setupErrorStatus);
});

async function main(): Promise<number> {
  const log = (line: string) => console.log(line);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  let command;
  let profile;
  try {
    command = parseLoopArguments(process.argv.slice(2));
    if (command.kind === "help") {
      log(loopUsage);
      return 0;
    }
    profile = loadProfile(process.env);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }

  const now = () => new Date();
  const signal = interruptSignal(log);
  const paths = loopPaths(repositoryRoot);
  const workflow = composeWorkflow(repositoryRoot, profile, log, signal);
  const checkpointer = openLoopCheckpointer(paths);
  const evals = composeEvalContext(repositoryRoot, log, signal);
  try {
    return await runLoop(command, {
      paths, checkpointer, now, log, signal, newLoopId,
      steps: (loopId) => hostLoopSteps(loopId, paths, workflow, workflowPaths(repositoryRoot).threadFolder, evals.context, now, log),
    });
  } finally {
    evals.close();
    checkpointer.db.close();
    workflow.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run loop failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
