import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CompareReport, Discrepancy } from "../../contracts/generated/typescript/parity-compare-report.js";
import type { PlannedCase } from "../src/cases/case-plan.js";
import type { TriageDocument } from "../src/triage/triage-document.js";

const examples = join(resolve(dirname(fileURLToPath(import.meta.url)), "..", ".."), "contracts", "examples");

export function scratch(prefix = "workflow-diagnosis-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

/** A planned build or career case with three captures and a fixture file under `root`. */
export function plannedCase(root: string, name: string, mode: "build" | "career" = "build"): PlannedCase {
  const fixturePath = join(root, "fixtures", `${name}.chum`);
  mkdirSync(dirname(fixturePath), { recursive: true });
  writeFileSync(fixturePath, `<character>${name}</character>`);
  return {
    name: `${mode}-${name}`, characterFile: `${name}.chum`, fixturePath, mode, startupDelaySeconds: 0, settleMilliseconds: 0, captureFilter: null,
    actions: [
      { type: "capture", name: "common" },
      { type: "selectTab", name: "Skills" },
      { type: "waitFor", label: "Active Skills" },
      { type: "capture", name: "skills" },
      { type: "selectTab", name: "Armor", optional: true },
      { type: "capture", name: "armor" },
    ],
  };
}

export type Spot = { readonly case: string; readonly capture: string; readonly x: number };

/** A run folder per case with a report whose discrepancies sit at the spots, and crops on disk. */
export function runFolders(root: string, spots: readonly Spot[]): Record<string, string> {
  const exampleReport = JSON.parse(readFileSync(join(examples, "parity-compare-report.example.json"), "utf8")) as CompareReport;
  const folders: Record<string, string> = {};
  for (const name of [...new Set(spots.map((spot) => spot.case))]) {
    const folder = join(root, "runs", name);
    folders[name] = folder;
    mkdirSync(join(folder, "compare", "crops"), { recursive: true });
    copyFileSync(join(examples, "parity-execution-coverage.example.json"), join(folder, "coverage.json"));
    copyFileSync(join(examples, "parity-capture-results.example.json"), join(folder, "results.json"));
    const discrepancies = spots.filter((spot) => spot.case === name).map((spot, index): Discrepancy => {
      const id = `${name}/${spot.capture}#${index + 1}`;
      for (const side of ["canonical", "candidate"]) writeFileSync(join(folder, "compare", "crops", `${spot.capture}.${index + 1}.${side}.png`), `${side} ${id}`);
      return {
        id, case: name, capture: spot.capture, core: { x: spot.x, y: 50, width: 20, height: 10 }, crop: { x: spot.x - 5, y: 45, width: 30, height: 20 },
        differingPixels: 40, imageHash: `hash-${spot.x}`, representative: id,
        canonicalCrop: `compare/crops/${spot.capture}.${index + 1}.canonical.png`, candidateCrop: `compare/crops/${spot.capture}.${index + 1}.candidate.png`,
        canonicalOcr: { status: "text", text: "Free Knowledge Skill Points Remaining:" }, candidateOcr: { status: "empty" },
      };
    });
    writeFileSync(join(folder, "compare", "report.json"), JSON.stringify({ ...exampleReport, discrepancies }));
  }
  return folders;
}

/** A triage document with one cluster per distinct x of the spots. */
export function triageDocument(threadId: string, spots: readonly Spot[], folders: Record<string, string>): TriageDocument {
  const xs = [...new Set(spots.map((spot) => spot.x))];
  const completeness = { planned: 1, reported: 1, analysisFailed: 0, filtered: 0, optionalAbsent: 0, executionLost: 0, unaccounted: 0 };
  return {
    threadId,
    cases: Object.entries(folders).map(([name, runFolder]) => ({
      case: name, runFolder, capture: { status: 1, reusedFrom: null }, compare: { status: 1, reusedFrom: null },
      execution: { coverageValid: true, invalidReasons: [], canonicalSource: "live" },
      visual: { passed: 0, failed: 1, reportStatus: "differences", discrepancies: 1, groups: 1, completeness },
    })),
    clusters: xs.map((x) => {
      const members = spots.filter((spot) => spot.x === x).map((spot) => {
        const index = spots.filter((other) => other.case === spot.case).indexOf(spot) + 1;
        const folder = folders[spot.case]!;
        return {
          case: spot.case, capture: spot.capture, discrepancy: `${spot.case}/${spot.capture}#${index}`,
          core: { x, y: 50, width: 20, height: 10 }, crop: { x: x - 5, y: 45, width: 30, height: 20 }, differingPixels: 40,
          canonicalCrop: join(folder, "compare", "crops", `${spot.capture}.${index}.canonical.png`),
          candidateCrop: join(folder, "compare", "crops", `${spot.capture}.${index}.candidate.png`),
        };
      });
      return {
        id: `d-${String(x).padStart(16, "0")}`, known: false, imageHash: `hash-${x}`,
        cases: [...new Set(members.map((member) => member.case))], captures: [...new Set(members.map((member) => member.capture))], members,
      };
    }),
    otherFindings: [],
    totals: { cases: Object.keys(folders).length, discrepancies: spots.length, clusters: xs.length, newClusters: xs.length, knownClusters: 0, otherFindings: 0 },
  };
}

export function write(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/**
 * A git repository with the app's source and data folders: a committed file changed in the working tree, an
 * untracked and an ignored file, a deleted tracked file, and files outside the snapshot folders.
 */
export function repository(): string {
  const root = scratch("workflow-snapshot-");
  const git = (...args: string[]) => execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  write(root, ".gitignore", "Chummer/obj/\n");
  write(root, "Chummer/frmCreate.cs", "class frmCreate {}");
  write(root, "Chummer/deleted.cs", "gone");
  write(root, "Core/XmlManager.cs", "class XmlManager {}");
  write(root, "bin/data/skills.xml", "<skills/>");
  write(root, "bin/lang/en-us.xml", "<lang/>");
  write(root, "bin/ChummerGenSR4.exe", "binary");
  write(root, "README.md", "readme");
  git("add", "-A");
  git("commit", "-q", "-m", "initial");
  write(root, "Chummer/untracked.cs", "new");
  write(root, "Chummer/obj/ignored.cs", "ignored");
  rmSync(join(root, "Chummer/deleted.cs"));
  write(root, "Chummer/frmCreate.cs", "class frmCreate { int moved; }");
  return root;
}

export function readReport(runFolder: string): CompareReport {
  return JSON.parse(readFileSync(join(runFolder, "compare", "report.json"), "utf8")) as CompareReport;
}
