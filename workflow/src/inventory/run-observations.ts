import { existsSync } from "node:fs";
import { join } from "node:path";
import { CaptureSummarySchema } from "../../../contracts/generated/typescript/parity-capture-summary.js";
import { ExecutionCoverageSchema, type Outcome } from "../../../contracts/generated/typescript/parity-execution-coverage.js";
import { UiTreeSchema, type UiNode } from "../../../contracts/generated/typescript/parity-ui-tree.js";
import { SetupError } from "../host/setup-error.js";
import { listFiles } from "../steps/fingerprint.js";
import { readDocument } from "../steps/read-document.js";

/** A planned capture of a case as the candidate side ran it, with its tree when it was performed. */
export type CaptureObservation = {
  readonly capture: string;
  readonly outcome: Outcome;
  /** The index of its capture action; null when the side recorded no such action. */
  readonly actionIndex: number | null;
  readonly nodes: readonly UiNode[] | null;
};

export type CaseObservation = {
  readonly case: string;
  readonly captures: readonly CaptureObservation[];
  /** The indexes of the candidate side's performed `selectTab` actions. */
  readonly selectTabs: readonly number[];
};

export type RunObservation = {
  readonly runId: string;
  readonly runFolder: string;
  readonly candidateSha256: string;
  readonly cases: readonly CaseObservation[];
};

const candidate = "candidate";

/** A tree's nodes must start with the main window and name only earlier nodes as parents. */
function checkNodes(path: string, nodes: readonly UiNode[]): void {
  nodes.forEach((node, index) => {
    const valid = index === 0 ? node.parent === null : node.parent !== null && Number.isInteger(node.parent) && node.parent >= 0 && node.parent < index;
    if (!valid) throw new SetupError(`${path}: node ${index} has the parent ${node.parent}; the first node has none and every other names an earlier node.`);
  });
}

/** Reads every UI tree of a run, keyed by case and capture; a tree of another run or a second tree for one capture fails it. */
function readTrees(runFolder: string, folder: string, runId: string): Map<string, readonly UiNode[]> {
  const root = join(runFolder, folder);
  const trees = new Map<string, readonly UiNode[]>();
  if (!existsSync(root)) return trees;
  for (const file of listFiles(root, true).filter((path) => path.endsWith(".json"))) {
    const path = join(root, file);
    const tree = readDocument(path, UiTreeSchema);
    if (tree.runId !== runId) throw new SetupError(`${path} belongs to run ${tree.runId}, not ${runId}.`);
    checkNodes(path, tree.nodes);
    const key = `${tree.case}\n${tree.capture}`;
    if (trees.has(key)) throw new SetupError(`${runFolder} holds two UI trees for ${tree.case}/${tree.capture}.`);
    trees.set(key, tree.nodes);
  }
  return trees;
}

/**
 * Reads what a capture run made with `--ui-tree` shows about its candidate side: each planned capture's outcome with
 * its tree, and the performed `selectTab` actions. A run without trees, a performed capture without its tree, or a
 * tree for a capture that was not performed is a setup error.
 */
export function readRunObservation(runFolder: string): RunObservation {
  const summary = readDocument(join(runFolder, "summary.json"), CaptureSummarySchema);
  if (summary.uiTrees === undefined) throw new SetupError(`The capture run ${runFolder} recorded no UI trees: it was made without --ui-tree.`);
  const coverage = readDocument(join(runFolder, "coverage.json"), ExecutionCoverageSchema);
  const trees = readTrees(runFolder, summary.uiTrees, summary.runId);
  const used = new Set<string>();
  const cases = coverage.cases.map((item): CaseObservation => {
    const side = item.sides.find((entry) => entry.side === candidate);
    const actions = summary.cases.find((entry) => entry.case === item.case)?.sides.find((entry) => entry.side === candidate)?.actions;
    if (side === undefined || actions === undefined) throw new SetupError(`The capture run ${runFolder} has no candidate side for ${item.case}.`);
    const captures = side.captures.map((capture): CaptureObservation => {
      const key = `${item.case}\n${capture.capture}`;
      const nodes = trees.get(key) ?? null;
      if (capture.outcome === "performed" && nodes === null) {
        throw new SetupError(`The capture run ${runFolder} has no UI tree for the performed capture ${item.case}/${capture.capture}.`);
      }
      if (capture.outcome !== "performed" && nodes !== null) {
        throw new SetupError(`The capture run ${runFolder} has a UI tree for ${item.case}/${capture.capture}, whose capture was ${capture.outcome}.`);
      }
      if (nodes !== null) used.add(key);
      const action = actions.find((entry) => entry.action === `capture:${capture.capture}`);
      return { capture: capture.capture, outcome: capture.outcome, actionIndex: action?.index ?? null, nodes };
    });
    const selectTabs = actions.filter((entry) => entry.action.startsWith("selectTab:") && entry.outcome === "performed").map((entry) => entry.index);
    return { case: item.case, captures, selectTabs };
  });
  const stray = [...trees.keys()].filter((key) => !used.has(key));
  if (stray.length > 0) throw new SetupError(`The capture run ${runFolder} has UI trees for captures it did not plan: ${stray.map((key) => key.replace("\n", "/")).join(", ")}.`);
  const candidateSha256 = summary.candidate.sha256;
  if (candidateSha256 === undefined) throw new SetupError(`The capture run ${runFolder} records no candidate SHA-256.`);
  return { runId: summary.runId, runFolder, candidateSha256, cases };
}
