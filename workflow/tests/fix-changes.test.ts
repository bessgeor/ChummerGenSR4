import { deepStrictEqual, equal, match, ok, throws } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { test } from "node:test";
import { fixChangeFiles, renderProposal, renderTasks, renderVerification } from "../src/fixes/fix-documents.js";
import { fixArchiveInRepository, fixArchiveOf, fixesRootOf, openSpecArchiver, processOpenSpecCli, type OpenSpecCli } from "../src/fixes/fix-archiver.js";
import { fixChangeName, FixRecordSchema } from "../src/fixes/fix-record.js";
import { SetupError } from "../src/host/setup-error.js";
import { scratch } from "./diagnosis-fixtures.js";
import { fixRecord, repositoryRoot } from "./fix-fixtures.js";

test("a fix change's name joins the cluster and the thread's last eight characters", () => {
  equal(fixChangeName("d-14297e69d59676fd", "wf-20261002T044028Z-6ce809b5"), "fix-d-14297e69d59676fd-6ce809b5");
  equal(fixChangeName("D_1", "t"), "fix-d-1-t");
});

test("the artifacts are rendered from the record", () => {
  const record = fixRecord({ members: [{ case: "build-Diego", capture: "common", ocr: "Source:\n`Core`" }] });
  const proposal = renderProposal(record);
  for (const heading of ["## Why", "## What Changes", "## Discrepancy", "## Hypothesis", "## Evidence"]) ok(proposal.includes(heading), heading);
  ok(proposal.includes("`build-Diego/common`: change core at (640, 32), 12 x 14, 96 differing pixels; OCR canonical \"Source: 'Core'\""));
  ok(proposal.includes("- Challenge (record `wf-20261002T100000Z-1a2b3c4d/d-00000000000000aa/challenge/1`): no_alternative"));
  ok(proposal.includes("  - `build-rigger/common` differs"));
  ok(proposal.includes("1 member in the case `build-Diego` and the capture `common`."));
  ok(proposal.includes("- `Chummer/frmCreate.Designer.cs` modified, 1 line added, 1 removed"));
  equal(renderTasks(record).split("\n").filter((line) => line.startsWith("- [x] 1.1 \"Restore the label's location\". Files: `Chummer/frmCreate.Designer.cs`. Blocked by: none.")).length, 1);
  const verification = renderVerification(record);
  ok(verification.includes("- run `20261002T101000Z-0000bbbb`: execution status 0, coverage valid, 0 failures; visual 1 passed, 0 failed."));
  ok(verification.includes("### mode\n\n- Cases: none; captures: all.\n- Nothing new to capture."));
  ok(verification.includes("  - `career-Shpala/calendar` pre-existing (difference 0.02)"));
  throws(() => renderVerification(fixRecord({ widened: false })), /has no widening/);
});

test("a proposal of a cluster with more members than the record holds says how many it lists", () => {
  const record = fixRecord({ members: [{ case: "build-a", capture: "x" }, { case: "build-b", capture: "y" }] });
  const proposal = renderProposal({ ...record, cluster: { ...record.cluster, members: 12 } });
  ok(proposal.includes("raw pixels of 12 captures (2 listed: build-a/x, build-b/y)."), proposal);
  ok(renderProposal(record).includes("raw pixels of 2 captures (build-a/x, build-b/y)."));
});

test("a subtask's blockers are listed by their task numbers", () => {
  const record = fixRecord();
  const two = { ...record, tasks: [record.tasks[0]!, { ...record.tasks[0]!, id: 2, blockedBy: [1], recordId: `${record.plan.recordId}/task-2` }] };
  ok(renderTasks(two).includes("Blocked by: 1.1. Record: `wf-20261002T100000Z-1a2b3c4d/d-00000000000000aa/repair/1/task-2`"));
});

test("the real CLI creates, validates and archives a fix change in a staging root", () => {
  const staging = join(scratch("workflow-fix-"), "staging");
  const record = fixRecord();
  const files = fixChangeFiles(record);
  const cli = processOpenSpecCli(repositoryRoot);
  const archived = openSpecArchiver(cli)({ fixesRoot: fixesRootOf(repositoryRoot), staging, name: record.name, files });
  match(basename(archived), new RegExp(`^\\d{4}-\\d{2}-\\d{2}-${record.name}$`));
  deepStrictEqual(readdirSync(archived).sort(), [".openspec.yaml", "fix.json", "proposal.md", "tasks.md", "verification.md"]);
  deepStrictEqual(FixRecordSchema.parse(JSON.parse(readFileSync(join(archived, "fix.json"), "utf8"))), record);
  match(readFileSync(join(archived, ".openspec.yaml"), "utf8"), /schema: fix/);
  ok(!existsSync(join(staging, "openspec", "changes", record.name)));
  match(cli(["validate", "--archived"], staging), /1 passed, 0 failed/);
});

test("the CLI's archived validation fails on an archived fix change with an open task and names the change", () => {
  const staging = join(scratch("workflow-fix-"), "staging");
  const record = fixRecord();
  const cli = processOpenSpecCli(repositoryRoot);
  const archived = openSpecArchiver(cli)({ fixesRoot: fixesRootOf(repositoryRoot), staging, name: record.name, files: fixChangeFiles(record) });
  const tasks = join(archived, "tasks.md");
  writeFileSync(tasks, readFileSync(tasks, "utf8").replace("- [x]", "- [ ]"));
  throws(() => cli(["validate", "--archived"], staging), (error: Error) => error instanceof SetupError && /exit 1/.test(error.message) && error.message.includes(record.name));
});

test("a fix change with an open task is refused before the CLI runs", () => {
  const calls: string[][] = [];
  const cli: OpenSpecCli = (args) => {
    calls.push([...args]);
    return "";
  };
  const record = fixRecord();
  const files = { ...fixChangeFiles(record), "tasks.md": "# Tasks\n\n- [x] 1.1 Done\n- [ ] 1.2 Not done\n" };
  throws(() => openSpecArchiver(cli)({ fixesRoot: fixesRootOf(repositoryRoot), staging: join(scratch("workflow-fix-"), "s"), name: record.name, files }),
    (error: Error) => error instanceof SetupError && /open tasks - \[ \] 1\.2 Not done/.test(error.message));
  throws(() => openSpecArchiver(cli)({ fixesRoot: fixesRootOf(repositoryRoot), staging: join(scratch("workflow-fix-"), "s"), name: record.name, files: { ...files, "tasks.md": "# Tasks\n" } }),
    /no checked task/);
  deepStrictEqual(calls, []);
});

test("a CLI failure is a setup error with the CLI's output, and nothing is archived after it", () => {
  const staging = join(scratch("workflow-fix-"), "staging");
  const calls: string[] = [];
  const real = processOpenSpecCli(repositoryRoot);
  const cli: OpenSpecCli = (args, cwd) => {
    calls.push(args[0]!);
    if (args[0] === "validate") throw new SetupError("openspec validate failed (exit 1): proposal is invalid");
    return real(args, cwd);
  };
  const record = fixRecord();
  throws(() => openSpecArchiver(cli)({ fixesRoot: fixesRootOf(repositoryRoot), staging, name: record.name, files: fixChangeFiles(record) }), /proposal is invalid/);
  deepStrictEqual(calls, ["new", "validate"]);
  throws(() => real(["validate", "no-such-change", "--strict", "--no-interactive"], staging), (error: Error) => error instanceof SetupError && /exit 1/.test(error.message));
});

test("a fix commit puts an archived change where retrieval reads the archive", () => {
  const root = "repository";
  equal(fixArchiveInRepository(), "fixes/openspec/changes/archive");
  equal(join(root, fixArchiveInRepository()), fixArchiveOf(fixesRootOf(root)));
});

test("a fixes root without the schema is a setup error", () => {
  const record = fixRecord();
  throws(() => openSpecArchiver(processOpenSpecCli(repositoryRoot))({ fixesRoot: scratch("workflow-fix-"), staging: join(scratch("workflow-fix-"), "s"), name: record.name, files: fixChangeFiles(record) }),
    /has no openspec\/config\.yaml/);
});
