// Builds the candidate (the app from the current source) into out/candidate/, never into bin/.
// The project's own output path is ..\bin\, which holds the canonical executable, so both the
// output and intermediate paths are overridden, and the canonical hash is checked before and after.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const canonical = join(root, "bin", "ChummerGenSR4.exe");
const pinnedSha256 = "9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56";
const outputDir = join(root, "out", "candidate", "bin") + "\\";
const intermediateDir = join(root, "out", "candidate", "obj") + "\\";

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function checkCanonical(when) {
  const actual = sha256(canonical);
  console.log(`Canonical SHA-256 ${when}: ${actual}`);
  if (actual !== pinnedSha256) {
    console.error(`bin/ChummerGenSR4.exe does not have the canonical hash ${pinnedSha256}.`);
    process.exit(1);
  }
}

function findMsbuild() {
  const vswhere = join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Microsoft Visual Studio", "Installer", "vswhere.exe");
  if (!existsSync(vswhere)) {
    throw new Error(`vswhere.exe not found at ${vswhere}; install Visual Studio Build Tools with the MSBuild component.`);
  }
  const result = spawnSync(vswhere, [
    "-latest", "-products", "*", "-requires", "Microsoft.Component.MSBuild",
    "-find", "MSBuild\\**\\Bin\\MSBuild.exe",
  ], { encoding: "utf8" });
  const msbuild = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim();
  if (result.status !== 0 || !msbuild) {
    throw new Error(`vswhere found no MSBuild.exe:\n${result.stderr}${result.stdout}`);
  }
  return msbuild;
}

checkCanonical("before");
const msbuild = findMsbuild();
const build = spawnSync(msbuild, [
  join(root, "Chummer", "Chummer.csproj"),
  "-nologo", "-verbosity:minimal", "-p:Configuration=Release",
  `-p:OutputPath=${outputDir}`,
  `-p:BaseIntermediateOutputPath=${intermediateDir}`,
], { stdio: "inherit" });
checkCanonical("after");
if (build.status !== 0) {
  console.error(`MSBuild failed with exit code ${build.status}.`);
  process.exit(build.status ?? 1);
}
const candidate = join(outputDir, "ChummerGenSR4.exe");
if (!existsSync(candidate)) {
  console.error(`MSBuild succeeded but ${candidate} is missing.`);
  process.exit(1);
}
console.log(`Candidate: ${candidate} (SHA-256 ${sha256(candidate)})`);
