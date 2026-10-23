import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { canonicalJson, ContextManifestSchema, contextHash, sealContext, type ContextInput } from "../src/diagnosis/context.js";
import { compiledSourceIdentity, createSourceSnapshot, processGit, type SourceSnapshot } from "../src/diagnosis/source-snapshot.js";
import { recordedCandidateSource, unrecordedSource } from "../src/diagnosis/candidate-source.js";
import { HostSteps } from "../src/host-steps.js";
import type { HostRunner } from "../src/host/host-runner.js";
import { SetupError } from "../src/host/setup-error.js";
import { workflowPaths } from "../src/paths.js";
import { plannedCase, readReport, repository, runFolders, scratch, triageDocument, write, type Spot } from "./diagnosis-fixtures.js";

test("the snapshot copies the working tree's source and data without history, ignored or deleted files", async () => {
  const root = repository();
  const target = join(scratch(), "source");
  const snapshot = await createSourceSnapshot(root, target, processGit(root));
  equal(snapshot.files, 5);
  ok(/^[0-9a-f]{40}$/.test(snapshot.commit));
  equal(readFileSync(join(target, "Chummer/frmCreate.cs"), "utf8"), "class frmCreate { int moved; }");
  ok(existsSync(join(target, "Chummer/untracked.cs")) && existsSync(join(target, "Core/XmlManager.cs")) && existsSync(join(target, "bin/data/skills.xml")) && existsSync(join(target, "bin/lang/en-us.xml")));
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
  const snapshot: SourceSnapshot = { folder: join(root, "diagnosis", "source"), identity: "s".repeat(64), compiledIdentity: "c".repeat(64), commit: "c".repeat(40), files: 3 };
  return {
    triage: triageDocument("wf-1", spots, folders), clusterId: "d-0000000000000100",
    cases: [plannedCase(root, "alpha"), plannedCase(root, "beta", "career")], readReport, snapshot, candidate: "candidate-hash",
  };
}

test("the compiled-source identity of the working tree equals the snapshot's; a data or language file does not change it, a source file does", async () => {
  const root = repository();
  const git = processGit(root);
  const snapshot = await createSourceSnapshot(root, join(scratch(), "source"), git);
  equal(await compiledSourceIdentity(root, git), snapshot.compiledIdentity);
  // Data and language files are no build input: the snapshot's identity changes, the compiled one does not.
  write(root, "bin/data/skills.xml", "<skills><skill/></skills>");
  write(root, "bin/lang/en-us.xml", "<lang><x/></lang>");
  equal(await compiledSourceIdentity(root, git), snapshot.compiledIdentity);
  ok((await createSourceSnapshot(root, join(scratch(), "source"), git)).identity !== snapshot.identity);
  write(root, "Chummer/frmCreate.cs", "class frmCreate { int edited; }");
  ok((await compiledSourceIdentity(root, git)) !== snapshot.compiledIdentity);
});

test("the class library under Core/ is compiled source: the snapshot copies it and an edit changes the compiled identity", async () => {
  const root = repository();
  const git = processGit(root);
  write(root, "Core/XmlManager.cs", "class XmlManager {}");
  const target = join(scratch(), "source");
  const snapshot = await createSourceSnapshot(root, target, git);
  equal(readFileSync(join(target, "Core/XmlManager.cs"), "utf8"), "class XmlManager {}");
  equal(await compiledSourceIdentity(root, git), snapshot.compiledIdentity);
  write(root, "Core/XmlManager.cs", "class XmlManager { int edited; }");
  ok((await compiledSourceIdentity(root, git)) !== snapshot.compiledIdentity);
});
test("the candidate build records the compiled source it started from, only when it ran and succeeded", async () => {
  const root = repository();
  const paths = workflowPaths(root);
  const git = processGit(root);
  equal(recordedCandidateSource(paths), unrecordedSource);
  let status = 1;
  let builds = 0;
  const host: HostRunner = {
    async run() {
      mkdirSync(paths.candidateApp, { recursive: true });
      // An edit while the compiler runs: the record keeps the source as the build started.
      write(root, "Chummer/frmCreate.cs", `class frmCreate { int editedWhileBuilding${++builds}; }`);
      return status;
    },
  };
  const steps = new HostSteps(paths, host, undefined as never, undefined as never, undefined as never, () => new Date(), undefined as never);
  await rejects(steps.buildCandidate(), SetupError);
  equal(recordedCandidateSource(paths), unrecordedSource);
  // A failed build records nothing. The next build records the source as it is when that build starts.
  status = 0;
  const atStart = await compiledSourceIdentity(root, git);
  await steps.buildCandidate();
  equal(recordedCandidateSource(paths), atStart);
  ok((await compiledSourceIdentity(root, git)) !== atStart);
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
