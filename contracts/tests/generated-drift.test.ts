// The drift check compares generated C# byte for byte, so C# written with other line endings than the CRLF
// pinned in .gitattributes is reported, while generated TypeScript may differ in line endings.
import { spawnSync } from "node:child_process";
import { equal, match } from "node:assert/strict";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function check(generated: string) {
  const result = spawnSync(process.execPath, [join(contractsDir, "scripts", "generate.mjs"), "--check", "--against", generated], { encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function copyOfGenerated(): string {
  const copy = mkdtempSync(join(tmpdir(), "contracts-drift-"));
  cpSync(join(contractsDir, "generated"), copy, { recursive: true });
  return copy;
}

/** Rewrites the first file with the extension and returns its name. */
function rewrite(folder: string, extension: string, convert: (text: string) => string): string {
  const file = readdirSync(folder, { recursive: true, withFileTypes: true })
    .find((entry) => entry.isFile() && entry.name.endsWith(extension));
  if (file === undefined) throw new Error(`No ${extension} file under ${folder}.`);
  const path = join(file.parentPath, file.name);
  writeFileSync(path, convert(readFileSync(path, "utf8")));
  return file.name;
}

test("generated C# with LF endings is drift, generated TypeScript with other line endings is not", () => {
  const copy = copyOfGenerated();
  try {
    equal(check(copy).status, 0);
    rewrite(copy, ".ts", (text) => text.replace(/\r?\n/g, "\r\n"));
    equal(check(copy).status, 0);
    const name = rewrite(copy, ".cs", (text) => text.replace(/\r\n/g, "\n"));
    const result = check(copy);
    equal(result.status, 1);
    match(result.output, new RegExp(`stale: contracts/generated/csharp/${name}`));
  } finally {
    rmSync(copy, { recursive: true, force: true });
  }
});
