// Composition root of `npm run inventory -- <options>`: the source inventory and the coverage manifest of capture runs
// made with --ui-tree. Exits with 0 or 3 (see --help).
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recordedCandidateSha256, recordedCandidateSource } from "../diagnosis/candidate-source.js";
import { processGit } from "../diagnosis/source-snapshot.js";
import { SetupError } from "../host/setup-error.js";
import { workflowPaths } from "../paths.js";
import { runInventoryCommand } from "./inventory-command.js";

const setupErrorStatus = 3;

async function main(): Promise<number> {
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const paths = workflowPaths(repositoryRoot);
  return runInventoryCommand(process.argv.slice(2), {
    repositoryRoot, git: processGit(repositoryRoot), now: () => new Date(), log: (line) => console.log(line),
    candidateSource: () => recordedCandidateSource(paths),
    candidateSha256: async () => {
      const recorded = recordedCandidateSha256(paths);
      if (recorded === undefined) throw new SetupError("The candidate has no recorded SHA-256: only the workflow's build step records it. Build it with npm start.");
      return recorded;
    },
  });
}

process.exitCode = await main().catch((error: unknown) => {
  console.error(error instanceof SetupError ? `Setup error: ${error.message}` : `npm run inventory failed: ${(error as Error).stack ?? String(error)}`);
  return setupErrorStatus;
});
