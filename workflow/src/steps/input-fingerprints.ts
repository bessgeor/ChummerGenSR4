import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { SetupError } from "../host/setup-error.js";
import type { RunOptions } from "../options/run-options.js";
import type { WorkflowPaths } from "../paths.js";
import { fingerprintFiles, fingerprintFolder, listFiles, sha256File, sha256Lines } from "./fingerprint.js";

/** The folders and files the capture runner's stager copies from the canonical app folder. */
const supportFolders = ["data", "lang", "settings", "sheets", "export"];
const supportFiles = ["manifestdata.xml", "manifestlang.xml"];

async function canonicalSupport(canonicalApp: string): Promise<string> {
  const paths: string[] = [];
  for (const folder of supportFolders) {
    paths.push(...listFiles(join(canonicalApp, folder), true).map((path) => `${folder}/${path}`));
  }
  for (const file of supportFiles) {
    if (!existsSync(join(canonicalApp, file))) throw new SetupError(`The canonical file is missing: ${join(canonicalApp, file)}`);
    paths.push(file);
  }
  return fingerprintFiles(canonicalApp, paths);
}

/** Like `canonicalSupport`, from sizes and modification times: cheap enough to repeat before every step. */
function canonicalSupportStat(canonicalApp: string): string {
  const lines: string[] = [];
  for (const folder of supportFolders) {
    for (const path of listFiles(join(canonicalApp, folder), true)) {
      const info = statSync(join(canonicalApp, folder, path));
      lines.push(`${folder}/${path}\t${info.size}\t${info.mtimeMs}`);
    }
  }
  for (const file of supportFiles) {
    const info = statSync(join(canonicalApp, file));
    lines.push(`${file}\t${info.size}\t${info.mtimeMs}`);
  }
  return sha256Lines(lines);
}

/** The capture runner's own assemblies, which also key its canonical cache. */
async function captureTools(folder: string): Promise<string> {
  const assemblies = listFiles(folder, false).filter((file) => /^Parity\..*\.dll$/.test(file));
  if (assemblies.length === 0) throw new SetupError(`No Parity assemblies in ${folder}; the tools are not built.`);
  return fingerprintFiles(folder, assemblies);
}

/**
 * Everything the comparer runs from: its assemblies, the third-party and native libraries (the OCR engine) and the
 * default OCR language data, which sit in its output folder. Debug symbols do not change what it does.
 */
async function compareTools(folder: string): Promise<string> {
  if (!existsSync(join(folder, "Parity.Compare.dll"))) throw new SetupError(`No Parity.Compare.dll in ${folder}; the tools are not built.`);
  return fingerprintFiles(folder, listFiles(folder, true).filter((file) => !file.endsWith(".pdb")));
}

type Computer = (paths: WorkflowPaths, options: Pick<RunOptions, "settingsOverlay" | "tessdata">) => Promise<string> | string;

/** The inputs a thread must see unchanged, each with the way to fingerprint it. */
const changeable = {
  canonicalExecutable: (paths) => sha256File(join(paths.canonicalApp, "ChummerGenSR4.exe")),
  canonicalSupportStat: (paths) => canonicalSupportStat(paths.canonicalApp),
  candidate: (paths) => {
    if (!existsSync(join(paths.candidateApp, "ChummerGenSR4.exe"))) {
      throw new SetupError(`The candidate is not built: ${join(paths.candidateApp, "ChummerGenSR4.exe")} is missing (run npm run build:candidate).`);
    }
    return fingerprintFolder(paths.candidateApp, false);
  },
  overlay: (_paths, options) => (options.settingsOverlay === null ? "none" : fingerprintFolder(options.settingsOverlay, true)),
  captureTools: (paths) => captureTools(paths.captureTools),
  compareTools: (paths) => compareTools(paths.compareTools),
  /** The contents of a `--tessdata` folder; the default language data is part of the comparer's folder. */
  tessdata: (_paths, options) => (options.tessdata === null ? "default" : fingerprintFolder(options.tessdata, true)),
} satisfies Record<string, Computer>;

export type ChangeableInput = keyof typeof changeable;

/** The inputs every capture step checks again before it runs. */
export const captureInputs: readonly ChangeableInput[] = ["canonicalExecutable", "canonicalSupportStat", "candidate", "overlay", "captureTools"];
/** The inputs every compare step checks again before it runs. */
export const compareInputs: readonly ChangeableInput[] = ["compareTools", "tessdata"];

/** Fingerprints of the inputs shared by every step of a thread, taken when the thread starts. */
export type InputFingerprints = { readonly [Name in ChangeableInput]: string } & {
  /** The canonical support files by content; the stat fingerprint above guards them while the thread runs. */
  readonly canonicalSupport: string;
};

export async function currentFingerprints<Name extends ChangeableInput>(
  paths: WorkflowPaths, options: Pick<RunOptions, "settingsOverlay" | "tessdata">, names: readonly Name[],
): Promise<{ readonly [N in Name]: string }> {
  const result: Partial<Record<Name, string>> = {};
  for (const name of names) {
    result[name] = await changeable[name](paths, options);
  }
  return result as { readonly [N in Name]: string };
}

export async function fingerprintInputs(paths: WorkflowPaths, options: Pick<RunOptions, "settingsOverlay" | "tessdata">): Promise<InputFingerprints> {
  return {
    ...(await currentFingerprints(paths, options, Object.keys(changeable) as ChangeableInput[])) as { readonly [N in ChangeableInput]: string },
    canonicalSupport: await canonicalSupport(paths.canonicalApp),
  };
}

/** What changed since the thread started, among the inputs a step checks; empty when nothing did. */
export async function changedInputs(
  paths: WorkflowPaths, options: Pick<RunOptions, "settingsOverlay" | "tessdata">, expected: InputFingerprints, names: readonly ChangeableInput[],
): Promise<ChangeableInput[]> {
  const current = await currentFingerprints(paths, options, names);
  return names.filter((name) => current[name] !== expected[name]);
}