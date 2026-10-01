import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, ContextManifestSchema, contextHash, sealContext, type ContextInput } from "../src/diagnosis/context.js";
import { sha256Lines } from "../src/steps/fingerprint.js";
import { createSourceSnapshot, processGit, sourceLines, type SourceSnapshot } from "../src/diagnosis/source-snapshot.js";
import { SetupError } from "../src/host/setup-error.js";
import { plannedCase, readReport, repository, runFolders, scratch, triageDocument, write, type Spot } from "./diagnosis-fixtures.js";

test("the snapshot copies the working tree's source and data without history, ignored or deleted files", async () => {
  const root = repository();
  const target = join(scratch(), "source");
  const snapshot = await createSourceSnapshot(root, target, processGit(root));
  equal(snapshot.files, 4);
  ok(/^[0-9a-f]{40}$/.test(snapshot.commit));
  equal(readFileSync(join(target, "Chummer/frmCreate.cs"), "utf8"), "class frmCreate { int moved; }");
  ok(existsSync(join(target, "Chummer/untracked.cs")) && existsSync(join(target, "bin/data/skills.xml")) && existsSync(join(target, "bin/lang/en-us.xml")));
  for (const absent of ["Chummer/obj/ignored.cs", "Chummer/deleted.cs", "bin/ChummerGenSR4.exe", "README.md", ".git"]) ok(!existsSync(join(target, absent)), absent);
  const again = await createSourceSnapshot(root, target, processGit(root));
  equal(again.identity, snapshot.identity);
  write(root, "bin/data/skills.xml", "<skills changed='1'/>");
  ok((await createSourceSnapshot(root, target, processGit(root))).identity !== snapshot.identity);
});

const spots: Spot[] = [
  { case: "build-alpha", capture: "skills", x: 100 },
  { case: "career-beta", capture: "skills", x: 100 },
  { case: "build-alpha", capture: "common", x: 400 },
];

function contextInput(root: string): ContextInput {
  const folders = runFolders(root, spots);
  const snapshot: SourceSnapshot = { folder: join(root, "diagnosis", "source"), identity: "s".repeat(64), commit: "c".repeat(40), files: 3 };
  return {
    triage: triageDocument("wf-1", spots, folders), clusterId: "d-0000000000000100",
    cases: [plannedCase(root, "alpha"), plannedCase(root, "beta", "career")], readReport, snapshot, candidate: "candidate-hash",
  };
}

test("the source lines of the working tree, without copying, give the identity of its snapshot; any change to a data or source file changes it", async () => {
  const root = repository();
  const git = processGit(root);
  const snapshot = await createSourceSnapshot(root, join(scratch(), "source"), git);
  equal(sha256Lines(await sourceLines(root, git)), snapshot.identity);
  // A data file is part of the identity, though it is not an input of the build.
  write(root, "bin/data/skills.xml", "<skills><skill/></skills>");
  ok(sha256Lines(await sourceLines(root, git)) !== snapshot.identity);
});
test("a sealed context holds the members, scenarios, vocabulary and source identity, with copied crops", async () => {
  const root = scratch();
  const folder = join(root, "diagnosis", "d-0000000000000100");
  const sealed = await sealContext(contextInput(root), folder);
  const manifest = sealed.manifest;
  deepStrictEqual(manifest.cluster, { id: "d-0000000000000100", imageHash: "hash-100", known: false, cases: ["build-alpha", "career-beta"], captures: ["skills"], members: 2 });
  deepStrictEqual(manifest.members.map((member) => [member.case, member.canonicalCrop, member.candidateCrop]),
    [["build-alpha", "evidence/1-canonical.png", "evidence/1-candidate.png"], ["career-beta", "evidence/2-canonical.png", "evidence/2-candidate.png"]]);
  equal(readFileSync(join(folder, "evidence", "1-canonical.png"), "utf8"), "canonical build-alpha/skills#1");
  deepStrictEqual(manifest.members[0]!.canonicalOcr, { status: "text", text: "Free Knowledge Skill Points Remaining:" });
  deepStrictEqual(manifest.members[0]!.candidateOcr, { status: "empty", text: null });
  deepStrictEqual(manifest.scenarios.map((scenario) => [scenario.case, scenario.mode, scenario.fixture.file, scenario.actions.length]),
    [["build-alpha", "build", "alpha.chum", 4], ["career-beta", "career", "beta.chum", 4]]);
  ok(/^[0-9a-f]{64}$/.test(manifest.scenarios[0]!.fixture.sha256));
  deepStrictEqual(manifest.vocabulary, [
    { case: "build-alpha", mode: "build", captures: ["common", "skills", "armor"] },
    { case: "career-beta", mode: "career", captures: ["common", "skills", "armor"] },
  ]);
  deepStrictEqual(manifest.source, { folder: "../source", identity: "s".repeat(64), commit: "c".repeat(40), candidate: "candidate-hash" });
  deepStrictEqual(ContextManifestSchema.parse(JSON.parse(readFileSync(join(folder, "context.json"), "utf8"))), manifest);
  equal(sealed.hash, contextHash(manifest));
});

test("sealing again from the same run gives the same hash; other evidence another", async () => {
  const root = scratch();
  const input = contextInput(root);
  const first = await sealContext(input, join(root, "a"));
  const second = await sealContext(input, join(root, "b"));
  equal(first.hash, second.hash);
  const other = await sealContext({ ...input, candidate: "other-candidate" }, join(root, "c"));
  ok(other.hash !== first.hash);
  equal(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] }), "{\"a\":[{\"c\":3,\"d\":2}],\"b\":1}");
});

test("a missing crop, an unknown cluster and an unknown case are setup errors", async () => {
  const root = scratch();
  const input = contextInput(root);
  const missing = input.triage.clusters[0]!.members[1]!.candidateCrop;
  rmSync(missing);
  await rejects(sealContext(input, join(root, "x")), (error: Error) => error instanceof SetupError && error.message.includes(missing) && /does not exist/.test(error.message));
  await rejects(sealContext({ ...contextInput(scratch()), clusterId: "d-none" }, join(root, "y")), /no cluster d-none/);
  const unknownCase = contextInput(scratch());
  await rejects(sealContext({ ...unknownCase, cases: [unknownCase.cases[0]!] }, join(root, "z")), /case career-beta/);
});
