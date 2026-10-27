// Command line of the parity workflow: `npm start -- <options>` runs or resumes a thread of the graph
// build → capture → compare → triage → inventory → discovery or diagnosis → repair → widening and exits with 0, 1, 2 or 3 (see --help).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeWorkflow } from "./compose-workflow.js";
import { setupErrorStatus } from "./graph/run-workflow.js";
import { interruptSignal } from "./host/interrupt-signal.js";
import { SetupError } from "./host/setup-error.js";
import { parseArguments, usage } from "./options/arguments.js";
import { loadProfile } from "./options/profile.js";

// An unexpected error must not end with Node's status 1, which would read as visual differences.
process.on("uncaughtException", (error) => {
  console.error(`npm start failed: ${error.stack ?? String(error)}`);
  process.exit(setupErrorStatus);
});

async function main(): Promise<number> {
  const log = (line: string) => console.log(line);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  let command;
  let profile;
  try {
    command = parseArguments(process.argv.slice(2));
    if (command.kind === "help") {
      log(usage);
      return 0;
    }
    profile = loadProfile(process.env);
  } catch (error) {
    if (!(error instanceof SetupError)) throw error;
    log(`Setup error: ${error.message}`);
    return setupErrorStatus;
  }

  const workflow = composeWorkflow(repositoryRoot, profile, log, interruptSignal(log));
  try {
    return await workflow.run(command);
  } finally {
    workflow.close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm start failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
