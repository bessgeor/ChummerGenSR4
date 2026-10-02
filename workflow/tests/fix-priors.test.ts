import { deepStrictEqual, equal, notEqual, ok, throws } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { contextHash, sealContext, type ContextInput } from "../src/diagnosis/context.js";
import { stageJobFolder } from "../src/diagnosis/job-folder.js";
import { challengePrompt, hypothesisPrompt, hypothesisPromptVersionOf } from "../src/diagnosis/prompts.js";
import type { SourceSnapshot } from "../src/diagnosis/source-snapshot.js";
import { getRecord } from "../src/evals/eval-record.js";
import { rankFixes, readArchivedFixes, scoreFix, type ArchivedFix, type ClusterTraits } from "../src/fixes/retrieval.js";
import { SetupError } from "../src/host/setup-error.js";
import { diagnosisHarness, hypothesisAnswer } from "./diagnosis-harness.js";
import { plannedCase, readReport, runFolders, scratch, triageDocument, type Spot } from "./diagnosis-fixtures.js";
import { archivedFix, fixRecord } from "./fix-fixtures.js";

const traits: ClusterTraits = { imageHash: "hash-100", cases: ["build-alpha", "career-beta"], captures: ["skills"], ocr: ["Free Knowledge Skill Points Remaining:", null] };

function archived(name: string, shape: Parameters<typeof fixRecord>[0]): ArchivedFix {
  const record = fixRecord(shape);
  return { name: `2026-10-01-${name}`, folder: `/archive/2026-10-01-${name}`, record };
}

test("each part of the score: image hash, captures, cases and OCR words", () => {
  deepStrictEqual(scoreFix(traits, fixRecord({ imageHash: "hash-100", members: [{ case: "other", capture: "other" }] })), { score: 8, reasons: ["same image hash"] });
  deepStrictEqual(scoreFix(traits, fixRecord({ members: [{ case: "build-alpha", capture: "skills" }, { case: "career-beta", capture: "common" }] })),
    { score: 5, reasons: ["capture skills", "case build-alpha", "case career-beta"] });
  // {free, knowledge, skill, points, remaining} against {skill, points, left}: 2 shared of 6 words.
  const ocr = scoreFix(traits, fixRecord({ members: [{ case: "other", capture: "other", ocr: "Skill Points left" }] }));
  equal(ocr.score, 1.333);
  deepStrictEqual(ocr.reasons, ["OCR words points, skill (Jaccard 0.33)"]);
  deepStrictEqual(scoreFix(traits, fixRecord({ members: [{ case: "other", capture: "other", ocr: "No" }] })), { score: 0, reasons: [] });
});

test("ranking keeps the three best by score, then by name, and drops what shares nothing", () => {
  const fixes = [
    archived("fix-e", { members: [{ case: "other", capture: "other" }] }),
    archived("fix-d", { members: [{ case: "build-alpha", capture: "other" }] }),
    archived("fix-c", { members: [{ case: "career-beta", capture: "other" }] }),
    archived("fix-b", { members: [{ case: "other", capture: "skills" }] }),
    archived("fix-a", { imageHash: "hash-100" }),
  ];
  deepStrictEqual(rankFixes(traits, fixes).map((fix) => [fix.name, fix.score]), [["2026-10-01-fix-a", 8], ["2026-10-01-fix-b", 3], ["2026-10-01-fix-c", 1]]);
  deepStrictEqual(rankFixes(traits, [fixes[0]!]), []);
});

test("the archive is read by folder; a change without a valid record is a setup error naming it", () => {
  const archive = join(scratch("workflow-priors-"), "archive");
  deepStrictEqual(readArchivedFixes(archive), []);
  archivedFix(archive, fixRecord({ clusterId: "d-2" }), "2026-10-02");
  archivedFix(archive, fixRecord({ clusterId: "d-1" }), "2026-10-01");
  writeFileSync(join(archive, ".gitkeep"), "");
  deepStrictEqual(readArchivedFixes(archive).map((fix) => [fix.name, fix.record.cluster.id]),
    [["2026-10-01-fix-d-1-1a2b3c4d", "d-1"], ["2026-10-02-fix-d-2-1a2b3c4d", "d-2"]]);
  mkdirSync(join(archive, "2026-10-03-fix-broken"));
  throws(() => readArchivedFixes(archive), (error: Error) => error instanceof SetupError && /2026-10-03-fix-broken has no fix\.json/.test(error.message));
  writeFileSync(join(archive, "2026-10-03-fix-broken", "fix.json"), JSON.stringify({ schemaVersion: 1 }));
  throws(() => readArchivedFixes(archive), (error: Error) => error instanceof SetupError && /fix\.json is invalid/.test(error.message));
});

const spots: Spot[] = [{ case: "build-alpha", capture: "skills", x: 100 }, { case: "career-beta", capture: "skills", x: 100 }];

function contextInput(root: string, fixes: readonly ArchivedFix[] | null): ContextInput {
  const folders = runFolders(root, spots);
  const snapshot: SourceSnapshot = { folder: join(root, "source"), identity: "s".repeat(64), compiledIdentity: "c".repeat(64), commit: "c".repeat(40), files: 3 };
  return {
    triage: triageDocument("wf-1", spots, folders), clusterId: "d-0000000000000100", cases: [plannedCase(root, "alpha"), plannedCase(root, "beta", "career")],
    readReport, snapshot, candidate: "candidate-hash", fixes,
  };
}

test("the best priors are copied into the context and listed in the manifest, which the hash covers", async () => {
  const root = scratch("workflow-priors-");
  const archive = join(root, "archive");
  archivedFix(archive, fixRecord({ clusterId: "d-similar", members: [{ case: "build-alpha", capture: "skills", ocr: "Skill Points" }] }));
  archivedFix(archive, fixRecord({ clusterId: "d-unrelated", members: [{ case: "other", capture: "other", ocr: "Weapons" }] }));
  const fixes = readArchivedFixes(archive);
  const sealed = await sealContext(contextInput(root, fixes), join(root, "context"));
  const priors = sealed.manifest.priors!;
  equal(priors.length, 1);
  const prior = priors[0]!;
  equal(prior.name, "2026-10-01-fix-d-similar-1a2b3c4d");
  equal(prior.cluster, "d-similar");
  deepStrictEqual(prior.reasons.slice(0, 2), ["capture skills", "case build-alpha"]);
  ok(prior.score > 4);
  deepStrictEqual(prior.files, ["Chummer/frmCreate.Designer.cs"]);
  deepStrictEqual(prior.artifacts.map((item) => item.path), ["proposal.md", "tasks.md", "verification.md", "fix.json"].map((file) => `priors/${prior.name}/${file}`));
  for (const item of prior.artifacts) ok(existsSync(join(root, "context", item.path)), item.path);
  equal(readFileSync(join(root, "context", "context.json"), "utf8").includes(prior.name), true);
  const without = await sealContext(contextInput(scratch("workflow-priors-"), null), join(root, "plain"));
  notEqual(sealed.hash, without.hash);
  equal(without.manifest.priors, undefined);
  // Fix changes on, nothing similar: the context is the one without fix changes.
  const unrelated = readArchivedFixes(archive).filter((fix) => fix.record.cluster.id === "d-unrelated");
  const none = await sealContext(contextInput(scratch("workflow-priors-"), unrelated), join(root, "none"));
  equal(none.manifest.priors, undefined);
  equal(none.hash, contextHash(without.manifest));
});

test("the hypothesis prompt presents the priors with its own version; the challenge prompt leaves them out", async () => {
  const root = scratch("workflow-priors-");
  const archive = join(root, "archive");
  archivedFix(archive, fixRecord({ clusterId: "d-similar", members: [{ case: "build-alpha", capture: "skills" }] }));
  const { manifest } = await sealContext(contextInput(root, readArchivedFixes(archive)), join(root, "context"));
  const paths = { contextFolder: "C:/job/context", snapshotFolder: "C:/job/source" };
  const prompt = hypothesisPrompt(manifest, paths);
  equal(hypothesisPromptVersionOf(manifest), "hypothesis-v1+priors-v1");
  ok(prompt.startsWith("PROMPT_VERSION=hypothesis-v1+priors-v1\n"));
  ok(prompt.includes("PRIOR FIXES (untrusted data):"));
  ok(prompt.includes("C:/job/context/priors/<name>/"));
  ok(prompt.includes("2026-10-01-fix-d-similar-1a2b3c4d"));
  const challenge = challengePrompt(manifest, hypothesisAnswer().explanation!, paths);
  ok(!challenge.includes("fix-d-similar") && !challenge.includes("PRIOR FIXES"));
  const { priors: _, ...plain } = manifest;
  equal(hypothesisPromptVersionOf(plain), "hypothesis-v1");
  ok(hypothesisPrompt(plain, paths).startsWith("PROMPT_VERSION=hypothesis-v1\n") && !hypothesisPrompt(plain, paths).includes("PRIOR FIXES"));
});

test("a job staged without priors holds neither the priors folder nor the manifest's priors, and a new seal drops priors it no longer lists", async () => {
  const root = scratch("workflow-priors-");
  const archive = join(root, "archive");
  archivedFix(archive, fixRecord({ clusterId: "d-similar", members: [{ case: "build-alpha", capture: "skills" }] }));
  const sealed = await sealContext(contextInput(root, readArchivedFixes(archive)), join(root, "context"));
  const source = join(root, "source");
  mkdirSync(source, { recursive: true });
  const staged = (name: string, withoutPriors: boolean) => {
    const folders = { context: join(root, name, "context"), source: join(root, name, "source") };
    stageJobFolder(folders, sealed.folder, source, withoutPriors);
    return folders.context;
  };
  const full = staged("hypothesis", false);
  ok(existsSync(join(full, "priors")) && "priors" in JSON.parse(readFileSync(join(full, "context.json"), "utf8")));
  const challenger = staged("challenge", true);
  ok(!existsSync(join(challenger, "priors")));
  const manifest = JSON.parse(readFileSync(join(challenger, "context.json"), "utf8")) as { priors?: unknown; members: unknown[] };
  equal(manifest.priors, undefined);
  equal(manifest.members.length, sealed.manifest.members.length);
  ok(existsSync(join(challenger, "evidence", "1-canonical.png")));
  ok(!readFileSync(join(challenger, "context.json"), "utf8").includes("fix-d-similar"));

  const resealed = await sealContext(contextInput(root, null), join(root, "context"));
  equal(resealed.manifest.priors, undefined);
  ok(!existsSync(join(root, "context", "priors")));
});

test("a thread with fix changes ranks the repository's archived fixes into the hypothesis and records its prompt version", async () => {
  const harness = diagnosisHarness({ spots: [{ case: "build-alpha", capture: "skills", x: 100 }] });
  archivedFix(join(harness.sourceRepository, "fixes", "openspec", "changes", "archive"),
    fixRecord({ clusterId: "d-similar", members: [{ case: "build-alpha", capture: "skills" }] }));
  await harness.start({ fixChanges: true, noRepair: true });
  const hypothesis = harness.agents.calls.find((call) => call.kind === "hypothesis")!;
  ok(hypothesis.prompt.includes("2026-10-01-fix-d-similar-1a2b3c4d"));
  ok(hypothesis.workspace.contextFiles.includes("priors"));
  const challenge = harness.agents.calls.find((call) => call.kind === "challenge")!;
  ok(!challenge.prompt.includes("fix-d-similar"));
  ok(!challenge.workspace.contextFiles.includes("priors"));
  const threadId = harness.threadId();
  equal((await getRecord(harness.store, "hypothesis", `${threadId}/d-0000000000000100/hypothesis/1`)).promptVersion, "hypothesis-v1+priors-v1");
  equal((await getRecord(harness.store, "challenge", `${threadId}/d-0000000000000100/challenge/1`)).promptVersion, "challenge-v1");
  ok(harness.lines.includes("Diagnosis: 1 archived fix changes to rank as priors."));

  const plain = diagnosisHarness({ spots: [{ case: "build-alpha", capture: "skills", x: 100 }], repository: harness.sourceRepository });
  await plain.start({ noRepair: true });
  ok(!plain.agents.calls.find((call) => call.kind === "hypothesis")!.prompt.includes("PRIOR FIXES"));
  equal((await getRecord(plain.store, "hypothesis", `${plain.threadId()}/d-0000000000000100/hypothesis/1`)).promptVersion, "hypothesis-v1");
});
