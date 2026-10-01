// Runs the whole visual parity workflow: build the candidate, capture both executables, then compare
// the run that capture wrote. The comparer's options --no-ocr and --tessdata <dir> go to the comparer;
// every other argument goes to the capture runner. The comparer runs whenever capture finished its run
// (status 0, 1 or 2); the exit status is the higher of the two, which orders them by severity, or 3 when
// the build fails, capture ends with a setup error, or the comparer does not end with status 0, 1 or 2
// and a report whose status matches it (for example because the comparer could not be built).
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const setupError = 3;
const reportExitStatus = new Map([["clear", 0], ["differences", 1], ["analysis-failures", 2]]);

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this through npm: npm start -- <options>.");
  process.exit(setupError);
}

function npm(script, args) {
  const result = spawnSync(process.execPath, [npmCli, "run", script, "--", ...args], { stdio: "inherit" });
  if (result.error) {
    console.error(`npm run ${script} could not be started: ${result.error.message}`);
    return setupError;
  }
  // A null status means the child was killed; nothing it wrote can be trusted.
  return result.status ?? setupError;
}

/** Splits the arguments into the comparer's options and the capture runner's. */
function splitArguments(args) {
  const capture = [];
  const compare = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--no-ocr") {
      compare.push(args[index]);
    } else if (args[index] === "--tessdata") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        return { error: "Option '--tessdata' needs a value." };
      }
      compare.push(args[index], value);
      index++;
    } else {
      capture.push(args[index]);
    }
  }
  return { capture, compare };
}

/** The comparer's status, or a setup error when it did not end with a report that matches its status. */
function compareOutcome(runFolder, status) {
  if (status < 0 || status >= setupError) {
    console.error(`Compare exited with ${status}, so it wrote no complete report.`);
    return setupError;
  }
  const reportPath = join(runFolder, "compare", "report.json");
  if (!existsSync(reportPath)) {
    console.error(`Compare exited with ${status} but wrote no ${reportPath}; it did not analyze the run.`);
    return setupError;
  }
  let reportStatus;
  try {
    reportStatus = JSON.parse(readFileSync(reportPath, "utf8")).status;
  } catch (error) {
    console.error(`${reportPath} cannot be read: ${error.message}`);
    return setupError;
  }
  if (reportExitStatus.get(reportStatus) !== status) {
    console.error(`Compare exited with ${status}, but ${reportPath} has status '${reportStatus}'.`);
    return setupError;
  }
  return status;
}

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  const help = npm("parity", ["--help"]);
  console.log("npm start passes --no-ocr and --tessdata <dir> to the comparer; see npm run compare -- --help.");
  process.exit(help);
}

if (args.includes("--run-folder-file")) {
  console.error("npm start passes --run-folder-file to capture itself; run npm run parity to use it.");
  process.exit(setupError);
}

const split = splitArguments(args);
if (split.error) {
  console.error(split.error);
  process.exit(setupError);
}

const build = npm("build:candidate", []);
if (build !== 0) {
  console.error(`The candidate build failed (exit ${build}); capture and compare did not run.`);
  process.exit(setupError);
}

// Capture writes the full path of the run folder it created here, so compare analyzes exactly that run.
const scratch = mkdtempSync(join(tmpdir(), "parity-start-"));
const runFolderFile = join(scratch, "run-folder.txt");
let status;
try {
  const capture = npm("parity", [...split.capture, "--run-folder-file", runFolderFile]);
  if (capture >= setupError) {
    console.error(`Capture ended with a setup error (exit ${capture}); compare did not run.`);
    status = setupError;
  } else if (!existsSync(runFolderFile)) {
    console.error(`Capture exited with ${capture} but did not report its run folder; compare did not run.`);
    status = setupError;
  } else {
    const runFolder = readFileSync(runFolderFile, "utf8");
    const compare = compareOutcome(runFolder, npm("compare", ["--run", runFolder, ...split.compare]));
    status = Math.max(capture, compare);
    console.log(`Capture exit ${capture}, compare exit ${compare}: exit ${status}.`);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

process.exit(status);
