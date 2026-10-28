// Composition root of `npm run eval -- <command>`: labels, benchmark items, datasets, eval runs and certificates
// over the workflow's store. Exits with 0, 1, 2 or 3 (see --help).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SetupError } from "../host/setup-error.js";
import { composeEvalContext } from "./compose-eval-context.js";
import { runEvalCommand } from "./eval-commands.js";

const setupErrorStatus = 3;

/** Ctrl+C and closing the console stop the running model job; the command ends with the setup-error status. */
function interruptSignal(): AbortSignal {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGHUP", "SIGBREAK"] as const) process.once(signal, () => controller.abort());
  return controller.signal;
}

async function main(): Promise<number> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const { context, close } = composeEvalContext(repositoryRoot, (line) => console.log(line), interruptSignal());
  try {
    return await runEvalCommand(process.argv.slice(2), context);
  } finally {
    close();
  }
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run eval failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
