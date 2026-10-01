import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { SetupError } from "../host/setup-error.js";
import { sha256File } from "./fingerprint.js";

export const stepKinds = ["capture", "compare"] as const;
export type StepKind = (typeof stepKinds)[number];

export const StepRecordSchema = z.strictObject({
  kind: z.enum(stepKinds),
  key: z.string().regex(/^[0-9a-f]{64}$/),
  keyLines: z.array(z.string()),
  case: z.string(),
  runFolder: z.string(),
  status: z.union([z.literal(0), z.literal(1)]),
  threadId: z.string(),
  completedUtc: z.string(),
  outputs: z.array(z.strictObject({ path: z.string(), sha256: z.string() })).min(1),
});
export type StepRecord = z.infer<typeof StepRecordSchema>;

export type Lookup =
  | { readonly found: "valid"; readonly record: StepRecord }
  | { readonly found: "none" }
  | { readonly found: "stale"; readonly reason: string };

/** Completed host steps by kind and input key, as `<root>/<kind>/<key>.json`. */
export class StepStore {
  constructor(private readonly root: string) {}

  private path(kind: StepKind, key: string): string {
    return join(this.root, kind, `${key}.json`);
  }

  /** A record is valid only while every output it recorded still has its hash. */
  async lookup(kind: StepKind, key: string): Promise<Lookup> {
    const path = this.path(kind, key);
    if (!existsSync(path)) return { found: "none" };
    let record: StepRecord;
    try {
      record = StepRecordSchema.parse(JSON.parse(readFileSync(path, "utf8")));
    } catch (error) {
      throw new SetupError(`The step record ${path} cannot be read: ${(error as Error).message}`);
    }
    if (record.kind !== kind || record.key !== key) {
      throw new SetupError(`The step record ${path} names another step (${record.kind} ${record.key}).`);
    }
    for (const output of record.outputs) {
      const file = join(record.runFolder, output.path);
      if (!existsSync(file)) return { found: "stale", reason: `${file} no longer exists` };
      if ((await sha256File(file)) !== output.sha256) return { found: "stale", reason: `${file} changed since it was recorded` };
    }
    return { found: "valid", record };
  }

  /** Records the outputs' current hashes; written to a temporary file and renamed into place. */
  async save(record: Omit<StepRecord, "outputs" | "completedUtc">, outputs: readonly string[], now: Date): Promise<void> {
    const hashed = [];
    for (const output of outputs) {
      hashed.push({ path: output, sha256: await sha256File(join(record.runFolder, output)) });
    }
    const complete = StepRecordSchema.parse({ ...record, outputs: hashed, completedUtc: now.toISOString() });
    const path = this.path(record.kind, record.key);
    mkdirSync(join(this.root, record.kind), { recursive: true });
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(complete, null, 2)}\n`);
    renameSync(temporary, path);
  }
}
