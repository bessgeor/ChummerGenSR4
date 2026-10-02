import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fixChangeFiles } from "../src/fixes/fix-documents.js";
import { fixChangeName, type FixRecord } from "../src/fixes/fix-record.js";

/** The repository this checkout is: its `fixes/` root holds the `fix` schema the CLI tests use. */
export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export type FixShape = {
  readonly clusterId?: string;
  readonly threadId?: string;
  readonly imageHash?: string;
  readonly members?: readonly { case: string; capture: string; ocr?: string | null }[];
  readonly files?: readonly string[];
  readonly widened?: boolean;
};

/** A complete fix record of one cluster with one subtask, or a draft without its widening. */
export function fixRecord(shape: FixShape = {}): FixRecord {
  const clusterId = shape.clusterId ?? "d-00000000000000aa";
  const threadId = shape.threadId ?? "wf-20261002T100000Z-1a2b3c4d";
  const members = shape.members ?? [{ case: "build-Diego", capture: "common", ocr: "Source: Core 64" }];
  const files = shape.files ?? ["Chummer/frmCreate.Designer.cs"];
  const run = (name: string, passed: number) => ({ run: name, status: 0, coverageValid: true, failures: 0, passed, failed: 0 });
  return {
    schemaVersion: 1, name: fixChangeName(clusterId, threadId), threadId,
    cluster: {
      id: clusterId, imageHash: shape.imageHash ?? "hash-aa", cases: [...new Set(members.map((member) => member.case))],
      captures: [...new Set(members.map((member) => member.capture))], members: members.length,
    },
    members: members.map((member) => ({
      case: member.case, capture: member.capture, core: { x: 640, y: 32, width: 12, height: 14 }, differingPixels: 96,
      canonicalOcr: member.ocr ?? null, candidateOcr: member.ocr ?? null,
    })),
    hypothesis: {
      recordId: `${threadId}/${clusterId}/hypothesis/1`, claim: "lblMetatypeSourceLabel is drawn 12 px right of the canonical position.", mechanism: "layout",
      locations: [{ path: "Chummer/frmCreate.Designer.cs", symbol: "lblMetatypeSourceLabel", line: 1200 }], evidence: "The caption moved; nothing else differs.", confidence: 0.8,
    },
    challenge: { recordId: `${threadId}/${clusterId}/challenge/1`, outcome: "no_alternative", reason: "Only the location explains a pure shift.", alternative: null },
    check: { outcome: "confirmed", run: "20261002T100500Z-0000aaaa", observations: [{ case: "build-rigger", capture: "common", observation: "differs", detail: "visual difference (0.01)" }] },
    plan: { recordId: `${threadId}/${clusterId}/repair/1`, reason: "One designer location.", summary: "Move the label back to (628, 32)." },
    tasks: [{
      id: 1, title: "Restore the label's location", instructions: "Set the location to (628, 32).", blockedBy: [], files: [...files],
      recordId: `${threadId}/${clusterId}/repair/1/task-1`, summary: "Moved the label back.",
    }],
    patch: { files: files.map((path) => ({ path, change: "modified" as const, added: 1, removed: 1 })), added: files.length, removed: files.length },
    narrowCheck: run("20261002T101000Z-0000bbbb", 1),
    widening: shape.widened === false ? null : [
      { level: "narrow", cases: ["build-Diego"], captures: ["common"], run: run("20261002T101100Z-0000cccc", 1), baseline: null, outcome: "passed", findings: [] },
      { level: "character", cases: ["build-Diego"], captures: null, run: run("20261002T101200Z-0000dddd", 13), baseline: null, outcome: "passed", findings: [] },
      { level: "mode", cases: [], captures: null, run: null, baseline: null, outcome: "nothing-new", findings: [] },
      {
        level: "suite", cases: ["career-Shpala"], captures: null, run: { ...run("20261002T101300Z-0000eeee", 12), failed: 1 }, baseline: run("20261002T101400Z-0000ffff", 0),
        outcome: "passed", findings: [{ case: "career-Shpala", capture: "calendar", attribution: "pre-existing", difference: 0.02, detail: "same candidate pixels as the baseline" }],
      },
    ],
  };
}

/** Writes a complete fix change as the CLI archives it, into `<archive>/<date>-<name>/`. */
export function archivedFix(archive: string, record: FixRecord, date = "2026-10-01"): string {
  const folder = join(archive, `${date}-${record.name}`);
  mkdirSync(folder, { recursive: true });
  for (const [file, content] of Object.entries(fixChangeFiles(record))) writeFileSync(join(folder, file), content);
  writeFileSync(join(folder, ".openspec.yaml"), "schema: fix\ncreated: 2026-10-01\nskip_specs: true\n");
  return folder;
}
