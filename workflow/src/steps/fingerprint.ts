import { createHash } from "node:crypto";
import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { SetupError } from "../host/setup-error.js";

export function sha256Text(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of the lines joined with newlines. */
export function sha256Lines(lines: readonly string[]): string {
  return sha256Text(lines.join("\n"));
}

export function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

/** SHA-256 of a small file, read at once. */
export function sha256FileSync(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/** Relative paths with forward slashes of the files under a folder, ordinally sorted. */
export function listFiles(root: string, recursive: boolean): string[] {
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    throw new SetupError(`The folder ${root} does not exist.`);
  }
  return readdirSync(root, { recursive, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/** SHA-256 over every file's relative path and SHA-256, in the given order. */
export async function fingerprintFiles(root: string, relativePaths: readonly string[]): Promise<string> {
  const lines: string[] = [];
  for (const path of relativePaths) {
    lines.push(`${path}\t${await sha256File(join(root, path))}`);
  }
  return sha256Lines(lines);
}

export async function fingerprintFolder(root: string, recursive: boolean): Promise<string> {
  return fingerprintFiles(root, listFiles(root, recursive));
}
