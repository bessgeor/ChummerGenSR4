// Stands in for npm's CLI when start.test.mjs runs start.mjs: `run <script> -- <args>` appends the call
// to FAKE_NPM_LOG and behaves as FAKE_NPM (JSON) says for that script. Capture writes FAKE_NPM's
// runFolder to its --run-folder-file, or makes a folder of that path; compare writes a report with the given status to <run>/compare/.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [command, script, separator, ...args] = process.argv.slice(2);
if (command !== "run" || separator !== "--") {
  throw new Error(`Unexpected npm call: ${process.argv.slice(2).join(" ")}`);
}

const plan = JSON.parse(process.env.FAKE_NPM);
appendFileSync(process.env.FAKE_NPM_LOG, JSON.stringify({ script, args }) + "\n");
const step = plan[script] ?? { status: 0 };

if (script === "parity" && step.writeRunFolder) {
  writeFileSync(args[args.indexOf("--run-folder-file") + 1], plan.runFolder);
}

if (script === "parity" && step.runFolderFileIsFolder) {
  mkdirSync(args[args.indexOf("--run-folder-file") + 1]);
}

if (script === "compare" && step.reportStatus) {
  const compare = join(args[args.indexOf("--run") + 1], "compare");
  mkdirSync(compare, { recursive: true });
  writeFileSync(join(compare, "report.json"), JSON.stringify({ status: step.reportStatus }));
}

process.exit(step.status);
