// Round-trip contract test: every schema's example parses with the generated zod
// schema and serializes back to the same JSON value.
import { deepStrictEqual, ok } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ZodType } from "zod";

const contractsDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const schemaFiles = readdirSync(join(contractsDir, "schemas"))
  .filter((file) => file.endsWith(".schema.json"))
  .sort();

test("at least one schema exists", () => {
  ok(schemaFiles.length > 0);
});

for (const schemaFile of schemaFiles) {
  const baseName = schemaFile.slice(0, -".schema.json".length);

  test(`${baseName} round-trips through its zod schema`, async () => {
    const schema = JSON.parse(readFileSync(join(contractsDir, "schemas", schemaFile), "utf8")) as { title: string };
    const examplePath = join(contractsDir, "examples", `${baseName}.example.json`);
    ok(existsSync(examplePath), `${schemaFile} has no example at contracts/examples/${baseName}.example.json`);

    const moduleUrl = pathToFileURL(join(contractsDir, "generated", "typescript", `${baseName}.ts`)).href;
    const generated = (await import(moduleUrl)) as Record<string, unknown>;
    const zodSchema = generated[`${schema.title}Schema`] as ZodType | undefined;
    ok(zodSchema, `generated/typescript/${baseName}.ts exports no ${schema.title}Schema`);

    const example: unknown = JSON.parse(readFileSync(examplePath, "utf8"));
    const parsed = zodSchema.parse(example);
    deepStrictEqual(JSON.parse(JSON.stringify(parsed)), example);
  });
}
