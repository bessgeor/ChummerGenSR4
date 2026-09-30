// Generates C# (System.Text.Json) and TypeScript zod code from contracts/schemas
// with the pinned quicktype CLI. With --check, generates into a temporary folder
// and fails if the checked-in code under contracts/generated differs.
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemasDir = join(contractsDir, "schemas");
const generatedDir = join(contractsDir, "generated");
const require = createRequire(import.meta.url);
const quicktypeBin = join(dirname(require.resolve("quicktype/package.json")), "dist", "index.js");

function listSchemas() {
  return readdirSync(schemasDir)
    .filter((file) => file.endsWith(".schema.json"))
    .sort()
    .map((file) => {
      const baseName = file.slice(0, -".schema.json".length);
      const schema = JSON.parse(readFileSync(join(schemasDir, file), "utf8"));
      if (typeof schema.title !== "string" || !/^[A-Z][A-Za-z0-9]*$/.test(schema.title)) {
        throw new Error(`${file}: "title" must be a PascalCase type name.`);
      }
      return { file: join(schemasDir, file), baseName, title: schema.title };
    });
}

function runQuicktype(args) {
  const result = spawnSync(process.execPath, [quicktypeBin, "--telemetry", "disable", ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`quicktype ${args.join(" ")} failed:\n${result.stderr}${result.stdout}`);
  }
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n").replace(/\s*$/, "\n");
}

function generate(targetDir) {
  const csharpDir = join(targetDir, "csharp");
  const typescriptDir = join(targetDir, "typescript");
  mkdirSync(csharpDir, { recursive: true });
  mkdirSync(typescriptDir, { recursive: true });
  for (const schema of listSchemas()) {
    const csharpFile = join(csharpDir, `${schema.title}.g.cs`);
    runQuicktype([
      "--src-lang", "schema", "--lang", "cs", "--framework", "SystemTextJson",
      "--namespace", `Parity.Contracts.${schema.title}`, "--array-type", "list",
      "--check-required", "--top-level", schema.title, "--out", csharpFile, schema.file,
    ]);
    const typescriptFile = join(typescriptDir, `${schema.baseName}.ts`);
    runQuicktype([
      "--src-lang", "schema", "--lang", "typescript-zod",
      "--top-level", schema.title, "--out", typescriptFile, schema.file,
    ]);
    for (const file of [csharpFile, typescriptFile]) {
      writeFileSync(file, normalize(readFileSync(file, "utf8")));
    }
  }
}

function listFiles(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)).replaceAll("\\", "/"))
    .sort();
}

function check() {
  const scratch = mkdtempSync(join(tmpdir(), "contracts-"));
  try {
    generate(scratch);
    const expected = listFiles(scratch);
    const actual = listFiles(generatedDir);
    const problems = [];
    for (const file of expected) {
      if (!actual.includes(file)) {
        problems.push(`missing: contracts/generated/${file}`);
      } else if (normalize(readFileSync(join(generatedDir, file), "utf8")) !== readFileSync(join(scratch, file), "utf8")) {
        problems.push(`stale: contracts/generated/${file}`);
      }
    }
    for (const file of actual) {
      if (!expected.includes(file)) problems.push(`extra: contracts/generated/${file}`);
    }
    if (problems.length > 0) {
      console.error(`Generated contracts are out of date (run npm run contracts:generate):\n  ${problems.join("\n  ")}`);
      process.exit(1);
    }
    console.log(`Generated contracts are up to date (${expected.length} files).`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv.includes("--check")) {
  check();
} else {
  rmSync(generatedDir, { recursive: true, force: true });
  generate(generatedDir);
  console.log(`Generated ${listFiles(generatedDir).length} files under contracts/generated.`);
}
