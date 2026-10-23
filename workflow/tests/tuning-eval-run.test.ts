import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { listRecords } from "../src/evals/eval-record.js";
import { readRun, resumeEvalRun, runFolders, startEvalRun } from "../src/evals/eval-run.js";
import { SetupError } from "../src/host/setup-error.js";
import { writeActiveFile } from "../src/tuning/active-configuration.js";
import { candidatesFolder, storeCandidate } from "../src/tuning/candidates.js";
import { tuningId } from "../src/tuning/tuning.js";
import { FakeAgents, hypothesisAnswer } from "./diagnosis-harness.js";
import { tuningFixture } from "./tuning-eval-fixtures.js";
import { tuning } from "./tuning-fixtures.js";

const configuration = tuning({ jobKind: "hypothesis" });
const version = `hypothesis-v2+${tuningId(configuration)}`;

test("a run of a configuration stores it, prompts and records with its version, and resumes with it", async () => {
  const fixture = await tuningFixture(100);
  const agents = new FakeAgents(() => ({ answer: hypothesisAnswer() }));
  const { folder } = await startEvalRun(fixture.dependencies(agents), { datasetFolder: fixture.dataset, partition: "test", repeat: 1, name: null, settings: resolveAgentSettings(undefined), tuning: configuration });
  const { settings } = readRun(folder);
  deepStrictEqual([settings.tuning, settings.promptVersion], [configuration, version]);
  ok(agents.calls.every((call) => call.prompt.startsWith(`PROMPT_VERSION=${version}\n`) && call.prompt.includes("TUNED GUIDANCE")));
  ok((await listRecords(fixture.threads.store)).filter((record) => record.origin === "eval-run").every((record) => record.promptVersion === version));

  // One sample is lost; the resume runs it with the stored configuration.
  rmSync(join(runFolders(folder).samples, readdirSync(runFolders(folder).samples)[0]!));
  const again = new FakeAgents(() => ({ answer: hypothesisAnswer() }));
  await resumeEvalRun(fixture.dependencies(again), settings.runId);
  ok(again.calls.length === 1 && again.calls[0]!.prompt.startsWith(`PROMPT_VERSION=${version}\n`));

  // A stored configuration whose base the code no longer has refuses the resume.
  writeFileSync(runFolders(folder).settings, JSON.stringify({ ...settings, tuning: { ...configuration, basePromptVersion: "hypothesis-v1" } }));
  await rejects(resumeEvalRun(fixture.dependencies(again), settings.runId), (error: unknown) => error instanceof SetupError && /extends hypothesis-v1/.test((error as Error).message));
});

test("a run stored without a configuration is read as one of the code's prompt", async () => {
  const fixture = await tuningFixture(100);
  const { folder } = await startEvalRun(fixture.dependencies(new FakeAgents()), { datasetFolder: fixture.dataset, partition: "test", repeat: 1, name: null, settings: resolveAgentSettings(undefined), tuning: null });
  const { tuning: _, ...old } = JSON.parse(readFileSync(runFolders(folder).settings, "utf8")) as Record<string, unknown>;
  writeFileSync(runFolders(folder).settings, JSON.stringify(old));
  equal(readRun(folder).settings.tuning, null);
  await resumeEvalRun(fixture.dependencies(new FakeAgents()), readRun(folder).settings.runId);
});

test("eval run takes the active configuration by default, the code's prompt with none, and a candidate only on development", async () => {
  const fixture = await tuningFixture(0);
  const context = { ...fixture.context, agents: () => new FakeAgents(() => ({ answer: hypothesisAnswer() })) };
  const runSettings = () => readdirSync(join(context.paths.evalsFolder, "runs")).map((run) => readRun(join(context.paths.evalsFolder, "runs", run)).settings);
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "development"], context), 0);
  equal(runSettings()[0]!.tuning, null);

  storeCandidate(candidatesFolder(context.paths.evalsFolder), { tuning: configuration, origin: "added", record: null, fromRun: null, datasetHash: null, rationale: null, createdUtc: "t" });
  await rejects(runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "test", "--tuning", tuningId(configuration)], context),
    (error: unknown) => error instanceof SetupError && /would use the holdout: start it with npm run eval -- tune holdout/.test((error as Error).message));
  await rejects(runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "all", "--tuning", tuningId(configuration)], context), /tune holdout/);
  await rejects(runEvalCommand(["run", "--dataset", fixture.dataset, "--tuning", "tuned-000000000000"], context), /There is no tuning candidate tuned-000000000000/);
  await rejects(runEvalCommand(["run", "--resume", "er-1", "--tuning", "none"], context), /--resume takes no --tuning/);
  equal(runSettings().length, 1);
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "development", "--tuning", tuningId(configuration)], context), 0);
  ok(runSettings().some((settings) => settings.promptVersion === version));

  // Once active, the configuration is what runs by default, also on the test partition.
  writeActiveFile(context.tuningFolder(), {
    schemaVersion: 1, jobKind: "hypothesis", active: { tuning: configuration, activatedUtc: "t", evidence: null, certificate: null },
    history: [{ tuning: null, activatedUtc: null, evidence: null, certificate: null }], rolledBack: [],
  });
  await rejects(runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "test"], context), /no item in the test partition/);
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "development", "--tuning", "none"], context), 0);
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "development"], context), 0);
  deepStrictEqual(runSettings().map((settings) => settings.promptVersion).sort(), ["hypothesis-v2", "hypothesis-v2", version, version]);
});
