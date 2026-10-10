import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { partitionOf } from "../src/evals/dataset.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { listRecords } from "../src/evals/eval-record.js";
import { reviewQueue } from "../src/evals/review-queue.js";
import { SetupError } from "../src/host/setup-error.js";
import { candidatesFolder, listCandidates, readCandidate } from "../src/tuning/candidates.js";
import { FakeAgents, hypothesisAnswer, type JobCall, type Reply } from "./diagnosis-harness.js";
import { scratch } from "./diagnosis-fixtures.js";
import { tuningFixture } from "./tuning-eval-fixtures.js";
import { tuning } from "./tuning-fixtures.js";

const clusters = ["d-0000000000000100", "d-0000000000000400"];
/** A seed that puts one cluster in test and the other in development. */
const mixedSeed = Array.from({ length: 100 }, (_, index) => `seed-${index}`).find((seed) => partitionOf(seed, clusters[0]!, 50) !== partitionOf(seed, clusters[1]!, 50))!;

const candidateAnswer = { outcome: "candidate", reason: "The job cites lines outside the file.", guidance: ["Check that every cited line exists."], context: "inline" };

/** Agents that answer hypotheses and reply to the tune job as given, keeping what the tune job's context held. */
function agents(tune: (call: JobCall) => Reply) {
  const seen: unknown[] = [];
  const fake = new FakeAgents((call) => {
    if (call.kind !== "tune") return { answer: hypothesisAnswer() };
    seen.push(JSON.parse(readFileSync(join(call.workspace.folder, "tuning-context.json"), "utf8")));
    return tune(call);
  });
  return { fake, seen };
}

async function developmentRun(testPercent: number, seed: string, tune: (call: JobCall) => Reply) {
  const fixture = await tuningFixture(testPercent, seed);
  const { fake, seen } = agents(tune);
  const context = { ...fixture.context, agents: () => fake };
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--partition", "development", "--tuning", "none"], context), 0);
  const runId = readdirSync(join(context.paths.evalsFolder, "runs"))[0]!;
  return { fixture, context, fake, seen, runId };
}

test("a proposal sees only the development run's samples and stores its candidate with its record", async () => {
  const { context, fake, seen, runId } = await developmentRun(50, mixedSeed, () => ({ answer: candidateAnswer }));
  equal(await runEvalCommand(["tune", "propose", "--run", runId], context), 0);
  const call = fake.calls.find((item) => item.kind === "tune")!;
  ok(call.prompt.startsWith("PROMPT_VERSION=tune-v1\n") && call.provider === "claude");
  deepStrictEqual(call.workspace.contextFiles, ["tuning-context.json"]);
  const shown = seen[0] as { jobKind: string; metric: string; measured: { tuning: unknown }; prompt: string; samples: { item: string; reference: unknown }[]; earlierCandidates: unknown[] };
  deepStrictEqual([shown.jobKind, shown.metric, shown.measured.tuning, shown.earlierCandidates], ["hypothesis", "prediction", null, []]);
  ok(shown.prompt.startsWith("PROMPT_VERSION=hypothesis-v2\n") && shown.prompt.includes("<working folder>"));
  const development = clusters.find((cluster) => partitionOf(mixedSeed, cluster, 50) === "development")!;
  const held = clusters.find((cluster) => cluster !== development)!;
  ok(shown.samples.length > 0 && shown.samples.every((sample) => (sample as unknown as { durationMs: number }).durationMs === 1000));
  ok(!JSON.stringify(seen[0]).includes(held) && JSON.stringify(seen[0]).includes(development), "only the development cluster is shown");
  const [candidate] = listCandidates(candidatesFolder(context.paths.evalsFolder), "hypothesis");
  deepStrictEqual([candidate!.origin, candidate!.fromRun, candidate!.tuning.guidance, candidate!.tuning.basePromptVersion, candidate!.rationale],
    ["proposed", runId, candidateAnswer.guidance, "hypothesis-v2", candidateAnswer.reason]);
  const record = (await listRecords(context.store)).find((item) => item.jobKind === "tune")!;
  deepStrictEqual([record.recordId, record.origin, record.subject, record.promptVersion, candidate!.record], [`${runId}/tune/1`, "workflow", { kind: "eval-run", id: runId }, "tune-v1", record.recordId]);
  equal(reviewQueue(await listRecords(context.store)).some((entry) => entry.record.jobKind === "tune"), false);

  // The next proposal sees the earlier candidate; one equal to it is the same candidate.
  equal(await runEvalCommand(["tune", "propose", "--run", runId], context), 0);
  deepStrictEqual((seen[1] as { earlierCandidates: { id: string; development: unknown }[] }).earlierCandidates.map((item) => [item.id, item.development]), [[candidate!.id, null]]);
  ok(context.lines.some((line) => line.includes(", already stored")));
});

test("a proposal equal to the measured configuration is invalid output; an abstention stores nothing", async () => {
  const equalAnswer = { outcome: "candidate", reason: "r", guidance: [], context: "inline" };
  const { context, runId } = await developmentRun(0, "s", () => ({ answer: equalAnswer }));
  equal(await runEvalCommand(["tune", "propose", "--run", runId], context), 2);
  ok(context.lines.some((line) => /Tune job failed: invalid_output: .*equals the configuration the run measured/.test(line)), context.lines.join("\n"));
  equal(existsSync(candidatesFolder(context.paths.evalsFolder)), false);
  const abstaining = { ...context, agents: () => new FakeAgents(() => ({ answer: { outcome: "abstain", reason: "The failures are environmental.", guidance: null, context: null } })) };
  equal(await runEvalCommand(["tune", "propose", "--run", runId], abstaining), 0);
  ok(context.lines.some((line) => line.startsWith("Tune job abstained: The failures are environmental.")));
  equal(existsSync(candidatesFolder(context.paths.evalsFolder)), false);
  const tooLong = { ...context, agents: () => new FakeAgents(() => ({ answer: { ...candidateAnswer, guidance: ["x".repeat(401)] } })) };
  equal(await runEvalCommand(["tune", "propose", "--run", runId], tooLong), 2);
});

test("a proposal from a test-partition run is a setup error and runs no job", async () => {
  const fixture = await tuningFixture(100);
  const fake = new FakeAgents(() => ({ answer: hypothesisAnswer() }));
  const context = { ...fixture.context, agents: () => fake };
  equal(await runEvalCommand(["run", "--dataset", fixture.dataset, "--tuning", "none"], context), 0);
  const runId = readdirSync(join(context.paths.evalsFolder, "runs"))[0]!;
  await rejects(runEvalCommand(["tune", "propose", "--run", runId], context), (error: unknown) => error instanceof SetupError && /test partition; a proposal sees only a development run/.test((error as Error).message));
  equal(fake.calls.some((call) => call.kind === "tune"), false);
});

test("tune add stores a person's configuration once and refuses anything but a configuration", async () => {
  const fixture = await tuningFixture(0);
  const folder = fixture.context.paths.evalsFolder;
  const file = join(scratch(), "candidate.json");
  writeFileSync(file, JSON.stringify({ ...tuning(), model: "other" }));
  await rejects(runEvalCommand(["tune", "add", "--file", file], fixture.context), /is not a valid configuration/);
  writeFileSync(file, JSON.stringify(tuning({ basePromptVersion: "scenario-v0" })));
  await rejects(runEvalCommand(["tune", "add", "--file", file], fixture.context), /extends scenario-v0/);
  writeFileSync(file, JSON.stringify(tuning()));
  equal(await runEvalCommand(["tune", "add", "--file", file], fixture.context), 0);
  equal(await runEvalCommand(["tune", "add", "--file", file], fixture.context), 0);
  ok(fixture.context.lines.some((line) => /is already stored; it is kept/.test(line)));
  const [stored] = listCandidates(candidatesFolder(folder), "scenario");
  deepStrictEqual([stored!.origin, readCandidate(candidatesFolder(folder), stored!.id).tuning], ["added", tuning()]);
});
