// Builds the candidate (the app from the current source) into out/candidate/, never into bin/.
// The project's own output path is ..\bin\, which holds the canonical executable, so both the
// output and intermediate paths are overridden, and the canonical hash is checked before and after.
//
// The app's class library (Core/Core.csproj) is built with it from the same source folder and keeps its
// intermediate files in Core\ below the given intermediate folder.
//
// Options: --source <folder> builds <folder>/Chummer/Chummer.csproj, with <folder>/Core/, instead of the repository's;
// --output <folder> puts the executable in <folder>/bin/ and intermediate files in <folder>/obj/;
// --log <file> writes an MSBuild file log.
// Exit status: 0 built, 1 the build failed, 3 setup error (canonical hash, MSBuild not found or stopped, options, any unexpected failure).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonical = join(root, "bin", "ChummerGenSR4.exe");
// Same value as CanonicalExecutableGuard.PinnedSha256 and AGENTS.md; Parity.Tests fails when they differ.
const pinnedSha256 = "9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56";

function setupError(message) {
  console.error(message);
  process.exit(3);
}

function parseOptions(args) {
  const options = { source: root, output: join(root, "out", "candidate"), log: null };
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    const value = args[index + 1];
    if (!["--source", "--output", "--log"].includes(name)) setupError(`Unknown option '${name}'.`);
    if (value === undefined || value.startsWith("--")) setupError(`Option '${name}' needs a value.`);
    options[name.slice(2)] = resolve(value);
  }
  return options;
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkCanonical(when) {
  const actual = sha256(canonical);
  console.log(`Canonical SHA-256 ${when}: ${actual}`);
  if (actual !== pinnedSha256) setupError(`bin/ChummerGenSR4.exe does not have the canonical hash ${pinnedSha256}.`);
}

function findMsbuild() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) {
    setupError(`vswhere.exe not found at ${vswhere}; install Visual Studio Build Tools with the MSBuild component.`);
  }
  const result = spawnSync(vswhere, [
    "-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild",
    "-find", "MSBuild\\**\\Bin\\MSBuild.exe",
  ], { encoding: "utf8" });
  const msbuild = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  if (result.status !== 0 || !msbuild) setupError(`vswhere found no MSBuild.exe:\n${result.stderr}${result.stdout}`);
  return msbuild;
}

function run() {
  const options = parseOptions(process.argv.slice(2));
  const project = join(options.source, "Chummer", "Chummer.csproj");
  if (!existsSync(project)) setupError(`There is no project ${project}.`);
  const outputDir = join(options.output, "bin") + "\\";
  const intermediateDir = join(options.output, "obj") + "\\";
  checkCanonical("before");
  const msbuild = findMsbuild();
  const build = spawnSync(msbuild, [
    project,
    "-restore", "-nologo", "-verbosity:minimal", "-p:Configuration=Release",
    `-p:OutputPath=${outputDir}`,
    `-p:BaseIntermediateOutputPath=${intermediateDir}`,
    ...(options.log === null ? [] : ["-fileLogger", `-fileLoggerParameters:LogFile=${options.log};Verbosity=normal;Encoding=UTF-8`]),
  ], { stdio: "inherit" });
  checkCanonical("after");
  if (build.error !== undefined) setupError(`MSBuild could not be started: ${build.error.message}`);
  if (build.status === null) setupError(`MSBuild was stopped by ${build.signal ?? "a signal"}.`);
  if (build.status !== 0) {
    console.error(`MSBuild failed with exit code ${build.status}.`);
    process.exit(1);
  }
  const candidate = join(outputDir, "ChummerGenSR4.exe");
  if (!existsSync(candidate)) {
    console.error(`MSBuild succeeded but ${candidate} is missing.`);
    process.exit(1);
  }
  console.log(`Candidate: ${candidate} (SHA-256 ${sha256(candidate)})`);
}

// Anything unexpected (an unreadable canonical executable, a failing spawn) is a setup error, never a failed build.
try {
  run();
} catch (error) {
  setupError(`Unexpected failure: ${error instanceof Error ? error.stack : error}`);
}
