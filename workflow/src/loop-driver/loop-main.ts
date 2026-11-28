// Command line of the loop: `npm run loop -- <options>` runs workflow threads and automatic tunings one after another
// until nothing changes, and exits with 0, 2 or 3 (see --help).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeWorkflow } from "../compose-workflow.js";
import { composeEvalContext } from "../evals/compose-eval-context.js";
import { setupErrorStatus } from "../graph/run-workflow.js";
import { interruptSignal } from "../host/interrupt-signal.js";
import { SetupError } from "../host/setup-error.js";
import { loadProfile, type Profile } from "../options/profile.js";
import { workflowPaths } from "../paths.js";
import { loopUsage, parseLoopArguments } from "./loop-arguments.js";
import { loopPaths, newLoopId } from "./loop-document.js";
import { pauseLoop } from "./pause-loop.js";
import { laneDefinitions } from "../lanes/lane-settings.js";
import { hostLoopSteps, openLoopCheckpointer, runLoop, stopLoop, type LoopComposition } from "./run-loop.js";

// An unexpected error must not end with Node's status 1.
process.on("uncaughtException", (error) => {
  console.error(`npm run loop failed: ${error.stack ?? String(error)}`);
  process.exit(setupErrorStatus);
});

/** Composes the workflow, the loop's checkpointer and the evaluation context of the tuning; what a failure left open is closed. */
function composeLoop(repositoryRoot: string, profile: Profile, loopId: string, now: () => Date, log: (line: string) => void,
  signal: AbortSignal): LoopComposition {
  const paths = loopPaths(repositoryRoot);
  const opened: (() => void)[] = [];
  const close = () => {
    for (const closing of opened.splice(0).reverse()) closing();
  };
  try {
    // The loop's control file pauses the desktop lanes of the composed workflow.
    const workflow = composeWorkflow(repositoryRoot, profile, log, signal, { loopFolder: paths.folder(loopId) });
    opened.push(workflow.close);
    const checkpointer = openLoopCheckpointer(paths);
    opened.push(() => checkpointer.db.close());
    const evals = composeEvalContext(repositoryRoot, log, signal);
    opened.push(evals.close);
    const threadFolder = workflowPaths(repositoryRoot).threadFolder;
    return { checkpointer, steps: hostLoopSteps(loopId, { paths, workflow, threadFolder, evalContext: evals.context, now, log }), close };
  } catch (error) {
    close();
    throw error;
  }
}

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
    if (command.kind === "stop") return stopLoop(command.loopId, loopPaths(repositoryRoot), () => new Date(), log);
    profile = loadProfile(process.env);
    if (command.kind === "pause") return pauseLoop(command, { paths: loopPaths(repositoryRoot), lanes: laneDefinitions(profile.lanes), now: () => new Date(), log });
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }

  const now = () => new Date();
  const signal = interruptSignal(log);
  return runLoop(command, {
    paths: loopPaths(repositoryRoot), compose: (loopId) => composeLoop(repositoryRoot, profile, loopId, now, log, signal), now, log, signal, newLoopId,
  });
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run loop failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
