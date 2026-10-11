import { deepStrictEqual, equal, ok, rejects } from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { certificatePath } from "../src/evals/certificate.js";
import { freezeDataset, partitionOf } from "../src/evals/dataset.js";
import { runEvalCommand, type EvalContext } from "../src/evals/eval-commands.js";
import { readRun } from "../src/evals/eval-run.js";
import { SetupError } from "../src/host/setup-error.js";
import { readActiveFile, tuningFiles } from "../src/tuning/active-configuration.js";
import { candidatesFolder, storeCandidate } from "../src/tuning/candidates.js";
import { passesDevelopmentGate } from "../src/tuning/development.js";
import { readLedger } from "../src/tuning/holdout.js";
import { tuningId, type Tuning } from "../src/tuning/tuning.js";
import { FakeAgents, hypothesisAnswer, type JobCall, type Reply } from "./diagnosis-harness.js";
import { tuningFixture } from "./tuning-eval-fixtures.js";
import { tuning } from "./tuning-fixtures.js";

const ids = ["d-0000000000000100", "d-0000000000000400"];
const seed = Array.from({ length: 100 }, (_, index) => `seed-${index}`).find((value) => partitionOf(value, ids[0]!, 50) !== partitionOf(value, ids[1]!, 50))!;
const developmentCluster = ids.find((id) => partitionOf(seed, id, 50) === "development")!;
const testCluster = ids.find((id) => id !== developmentCluster)!;

const allRight = tuning({ jobKind: "hypothesis", guidance: ["Predict the capture the discrepancy was found in."] });
const developmentOnly = tuning({ jobKind: "hypothesis", guidance: ["Overfit."] });
const third = tuning({ jobKind: "hypothesis", guidance: ["Another idea."] });

/** Which clusters a configuration answers right: the code's prompt only the test cluster, `allRight` and `third` both, `developmentOnly` the development one. */
function rightFor(call: JobCall): boolean {
  const cluster = ids.find((id) => call.prompt.includes(id))!;
  const version = /^PROMPT_VERSION=(\S+)/.exec(call.prompt)![1]!;
  const configuration = version.split("+")[1] ?? "none";
  if (configuration === "none") return cluster === testCluster;
  if (configuration === tuningId(developmentOnly)) return cluster === developmentCluster;
  return true;
}

/** A right answer predicts what the check observed (build-alpha/skills differs); a wrong one abstains, which fails the prediction metric. */
function reply(call: JobCall): Reply {
  return rightFor(call) ? { answer: hypothesisAnswer() } : { answer: { outcome: "abstain", reason: "No idea.", explanation: null } };
}

async function command(context: EvalContext, args: string[]): Promise<{ status: number; run: string | null }> {
  const runs = join(context.paths.evalsFolder, "runs");
  const before = new Set(existsSync(runs) ? readdirSync(runs) : []);
  const status = await runEvalCommand(args, context);
  const created = readdirSync(runs).filter((name) => !before.has(name));
  return { status, run: created[0] ?? null };
}

function add(context: EvalContext, configuration: Tuning): string {
  return storeCandidate(candidatesFolder(context.paths.evalsFolder), { tuning: configuration, origin: "added", record: null, fromRun: null, datasetHash: null, rationale: null, createdUtc: "t" }).candidate.id;
}

test("the holdout opens only to a candidate that beat the active configuration on development, records each exposure first, and is limited", async () => {
  const fixture = await tuningFixture(50, seed);
  const context: EvalContext & { lines: string[] } = { ...fixture.context, agents: () => new FakeAgents(reply) };
  const dataset = ["--dataset", fixture.dataset];
  const baseline = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", "none"])).run!;
  const developmentRun = async (configuration: Tuning) => (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", add(context, configuration)])).run!;
  const [a, b, c] = [await developmentRun(allRight), await developmentRun(developmentOnly), await developmentRun(third)];
  const holdout = (candidate: Tuning, run: string, extra: string[] = []) => command(context, ["tune", "holdout", "--candidate", tuningId(candidate), "--baseline", baseline, "--run", run, ...extra]);

  const opened = await holdout(allRight, a);
  equal(opened.status, 0, context.lines.join("\n"));
  const ledger = readLedger(context.tuningFolder());
  const exposure = ledger.exposures.at(-1)!;
  deepStrictEqual([exposure.candidate, exposure.testRun, exposure.development.baseline, exposure.development.candidate, exposure.development.verdict],
    [tuningId(allRight), opened.run, baseline, a, "improved"]);
  const testSettings = readRun(join(context.paths.evalsFolder, "runs", opened.run!)).settings;
  deepStrictEqual([testSettings.partition, testSettings.tuning, testSettings.name], ["test", allRight, `holdout ${tuningId(allRight)}`]);

  // Seen once per candidate; the second request is refused and writes nothing.
  equal((await holdout(allRight, a)).status, 1);
  ok(context.lines.some((line) => line.includes(`has already seen test items of tune v1`)));
  equal(readLedger(context.tuningFolder()).exposures.length, 1);

  equal((await holdout(developmentOnly, b)).status, 0);
  equal((await holdout(third, c, ["--max-exposures", "2"])).status, 1);
  equal(readLedger(context.tuningFolder()).exposures.length, 2);
  ok(context.lines.some((line) => /shown to 2 candidates \(at most 2\); a dataset with test items that no candidate has seen is needed/.test(line)));

  // A run that was never created (stopped between the ledger and the run) starts when the holdout is asked again; it is not a new exposure.
  rmSync(join(context.paths.evalsFolder, "runs", opened.run!), { recursive: true });
  equal((await holdout(allRight, a)).status, 0);
  deepStrictEqual([readLedger(context.tuningFolder()).exposures.length, existsSync(join(context.paths.evalsFolder, "runs", opened.run!, "summary.json"))], [2, true]);

  // A new version of the dataset keeps its seed and test share, and so its test items: its holdout is the same.
  const { folder: next } = await freezeDataset(await fixture.threads.input({ name: "tune", testPercent: 50, seed }));
  const nextBaseline = (await command(context, ["run", "--dataset", next, "--partition", "development", "--tuning", "none"])).run!;
  const nextRun = (await command(context, ["run", "--dataset", next, "--partition", "development", "--tuning", tuningId(third)])).run!;
  equal((await command(context, ["tune", "holdout", "--candidate", tuningId(allRight), "--baseline", nextBaseline, "--run", (await command(context, ["run", "--dataset", next, "--partition", "development", "--tuning", tuningId(allRight)])).run!])).status, 1);
  equal((await command(context, ["tune", "holdout", "--candidate", tuningId(third), "--baseline", nextBaseline, "--run", nextRun])).status, 0);
  equal(readLedger(context.tuningFolder()).exposures.length, 3);

  // Another seed with the same partitions is not a new holdout: the first dataset's exposures count against it.
  const otherSeed = Array.from({ length: 400 }, (_, index) => `other-${index}`).find((value) => ids.every((id) => partitionOf(value, id, 50) === partitionOf(seed, id, 50)))!;
  const { folder: reseeded } = await freezeDataset(await fixture.threads.input({ name: "tune-reseeded", testPercent: 50, seed: otherSeed }));
  const reseededBaseline = (await command(context, ["run", "--dataset", reseeded, "--partition", "development", "--tuning", "none"])).run!;
  const fourth = tuning({ jobKind: "hypothesis", guidance: ["A fourth idea."] });
  const reseededRun = (await command(context, ["run", "--dataset", reseeded, "--partition", "development", "--tuning", add(context, fourth)])).run!;
  equal((await command(context, ["tune", "holdout", "--candidate", tuningId(fourth), "--baseline", reseededBaseline, "--run", reseededRun])).status, 1);
  ok(context.lines.some((line) => /tune-reseeded v1 have been shown to 3 candidates/.test(line)), context.lines.join("\n"));
  equal(readLedger(context.tuningFolder()).exposures.length, 3);

  // A candidate's test run is certified only by tune activate.
  equal(await runEvalCommand(["certify", "--run", opened.run!, "--metric", "prediction", "--min-pass", "0"], context), 1);
  ok(context.lines.some((line) => line.includes(`the run measured ${tuningId(allRight)}, but none is active for hypothesis; a candidate is certified by tune activate`)));
  // Runs that cannot be paired are a setup error.
  await rejects(command(context, ["tune", "holdout", "--candidate", tuningId(third), "--baseline", opened.run!, "--run", c]), (error: unknown) => error instanceof SetupError && /not development/.test((error as Error).message));
});

test("a candidate no better on development than the active configuration is refused and the ledger is unchanged", async () => {
  const fixture = await tuningFixture(50, seed);
  // Every configuration answers alike: equal means, equal model time.
  const context: EvalContext & { lines: string[] } = { ...fixture.context, agents: () => new FakeAgents(() => ({ answer: { outcome: "abstain", reason: "r", explanation: null } })) };
  const baseline = (await command(context, ["run", "--dataset", fixture.dataset, "--partition", "development", "--tuning", "none"])).run!;
  const run = (await command(context, ["run", "--dataset", fixture.dataset, "--partition", "development", "--tuning", add(context, allRight)])).run!;
  equal((await command(context, ["tune", "holdout", "--candidate", tuningId(allRight), "--baseline", baseline, "--run", run])).status, 1);
  ok(context.lines.some((line) => /did not beat the active configuration on development: mean difference of prediction 0/.test(line)), context.lines.join("\n"));
  equal(existsSync(tuningFiles(context.tuningFolder()).holdout), false);
});

test("a killed holdout run keeps its exposure and resumes; activation is certified, refuses a worse candidate, and rollback restores the certificate", async () => {
  const fixture = await tuningFixture(50, seed);
  const controller = new AbortController();
  let hang = false;
  const agents = new FakeAgents((call) => {
    if (hang && call.prompt.includes(tuningId(allRight))) {
      setTimeout(() => controller.abort(), 50);
      return { hang: true };
    }
    return reply(call);
  });
  const context: EvalContext & { lines: string[] } = { ...fixture.context, agents: () => agents, signal: controller.signal };
  const dataset = ["--dataset", fixture.dataset];
  const baseline = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", "none"])).run!;
  const a = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", add(context, allRight)])).run!;
  const b = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", add(context, developmentOnly)])).run!;

  hang = true;
  await rejects(command(context, ["tune", "holdout", "--candidate", tuningId(allRight), "--baseline", baseline, "--run", a]), SetupError);
  hang = false;
  const killed = readLedger(context.tuningFolder()).exposures[0]!.testRun;
  equal(existsSync(join(context.paths.evalsFolder, "runs", killed)), true);
  const resumed = { ...context, signal: new AbortController().signal };
  equal(await runEvalCommand(["run", "--resume", killed], resumed), 0);
  const overfit = await command(resumed, ["tune", "holdout", "--candidate", tuningId(developmentOnly), "--baseline", baseline, "--run", b]);
  const testBaseline = (await command(resumed, ["run", ...dataset, "--partition", "test", "--tuning", "none"])).run!;

  // The code's prompt had a certificate; it is kept for the rollback.
  const certificates = resumed.certificatesFolder();
  mkdirSync(certificates, { recursive: true });
  const original = JSON.stringify({
    schemaVersion: 1, jobKind: "hypothesis", agent: { provider: "claude", model: null, effort: "medium" }, promptVersion: "hypothesis-v2", run: testBaseline,
    dataset: { name: "tune", version: 1, hash: "h", partition: "test" }, metric: "prediction", items: 2, passes: 2, rate: 1, interval: { low: 0.34, high: 1 },
    thresholds: { minPass: 0.3, maxMeanCostUsd: null }, meanCostUsd: null, issuedUtc: "2026-10-01T00:00:00.000Z",
  }, null, 2);
  writeFileSync(certificatePath(certificates, "hypothesis"), `${original}\n`);

  const activate = (run: string, minPass: string) => runEvalCommand(["tune", "activate", "--run", run, "--baseline", testBaseline, "--metric", "prediction", "--min-pass", minPass], resumed);
  equal(await activate(overfit.run!, "0"), 1);
  ok(resumed.lines.some((line) => /worse than the active configuration on the test partition/.test(line)), resumed.lines.join("\n"));
  equal(await activate(killed, "0.9"), 1);
  ok(resumed.lines.some((line) => /certificate: the lower bound .* is below 0.9/.test(line)));
  equal(await activate(testBaseline, "0"), 1);
  ok(resumed.lines.some((line) => line.includes(`the run ${testBaseline} is not the test run of a holdout exposure`)));
  // The candidate is activated on the metric it was gated on, not another one.
  equal(await runEvalCommand(["tune", "activate", "--run", killed, "--baseline", testBaseline, "--metric", "rootCause", "--min-pass", "0"], resumed), 1);
  ok(resumed.lines.some((line) => line.includes("the candidate was gated on development by prediction, not rootCause")), resumed.lines.join("\n"));
  equal(readActiveFile(resumed.tuningFolder(), "hypothesis"), null);
  equal(readFileSync(certificatePath(certificates, "hypothesis"), "utf8"), `${original}\n`);

  equal(await activate(killed, "0.3"), 0, resumed.lines.join("\n"));
  const active = readActiveFile(resumed.tuningFolder(), "hypothesis")!;
  deepStrictEqual([active.active.tuning, active.active.evidence?.test.verdict, active.active.evidence?.development.candidate, active.history.length, active.history[0]!.tuning],
    [allRight, "no-difference", a, 1, null]);
  equal(JSON.parse(readFileSync(certificatePath(certificates, "hypothesis"), "utf8")).promptVersion, `hypothesis-v2+${tuningId(allRight)}`);
  // Activating the same run again writes its certificate again, for an activation stopped before the certificate.
  rmSync(certificatePath(certificates, "hypothesis"));
  equal(await activate(killed, "0.3"), 0);
  equal(JSON.parse(readFileSync(certificatePath(certificates, "hypothesis"), "utf8")).promptVersion, `hypothesis-v2+${tuningId(allRight)}`);
  // Another threshold is another claim: it is checked, not answered from the stored activation, and the certificate stays as it is.
  rmSync(certificatePath(certificates, "hypothesis"));
  equal(await activate(killed, "0.2"), 1);
  ok(resumed.lines.some((line) => line.includes(`${tuningId(allRight)} is already active`)), resumed.lines.join("\n"));
  equal(existsSync(certificatePath(certificates, "hypothesis")), false);
  equal(await activate(killed, "0.3"), 0);
  // While the configuration is active, a run of the code's prompt is not certified.
  equal(await runEvalCommand(["certify", "--run", testBaseline, "--metric", "prediction", "--min-pass", "0"], resumed), 1);

  equal(await runEvalCommand(["tune", "rollback", "--job", "hypothesis", "--reason", "regressed in a workflow thread"], resumed), 0);
  const rolled = readActiveFile(resumed.tuningFolder(), "hypothesis")!;
  deepStrictEqual([rolled.active.tuning, rolled.history.length, rolled.rolledBack[0]!.tuning, rolled.rolledBack[0]!.reason], [null, 0, allRight, "regressed in a workflow thread"]);
  equal(readFileSync(certificatePath(certificates, "hypothesis"), "utf8"), `${original}\n`);
  await rejects(runEvalCommand(["tune", "rollback", "--job", "hypothesis"], resumed), /There is no earlier hypothesis configuration to roll back to/);
});

test("the development gate wants a better mean, or the same mean in less model time, and a value wherever the baseline has one", () => {
  const summary = { baseline: "er-1", candidate: "er-2", metric: "prediction" as const, pairs: 4, unpaired: 0, meanDifference: 0, interval: null, verdict: "no-difference" as const, modelTimeMeanDifferenceMs: -1000 };
  deepStrictEqual([
    passesDevelopmentGate(summary),
    passesDevelopmentGate({ ...summary, meanDifference: 0.25, modelTimeMeanDifferenceMs: 500 }),
    passesDevelopmentGate({ ...summary, modelTimeMeanDifferenceMs: 0 }),
    passesDevelopmentGate({ ...summary, meanDifference: null }),
    // A candidate that abstains where the baseline answered is not better for the time it saves.
    passesDevelopmentGate({ ...summary, unpaired: 1 }),
    passesDevelopmentGate({ ...summary, unpaired: 1, meanDifference: 0.25 }),
    // Rounding noise of equal means (two thirds and back) is no difference: the model time decides.
    passesDevelopmentGate({ ...summary, meanDifference: 2.8e-17, modelTimeMeanDifferenceMs: 500 }),
    passesDevelopmentGate({ ...summary, meanDifference: -2.8e-17 }),
  ], [true, true, false, false, false, false, false, true]);
});

test("rollback to an entry without a certificate removes the job kind's certificate", async () => {
  const fixture = await tuningFixture(50, seed);
  const context: EvalContext & { lines: string[] } = { ...fixture.context, agents: () => new FakeAgents(reply) };
  const dataset = ["--dataset", fixture.dataset];
  const baseline = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", "none"])).run!;
  const a = (await command(context, ["run", ...dataset, "--partition", "development", "--tuning", add(context, allRight)])).run!;
  const opened = await command(context, ["tune", "holdout", "--candidate", tuningId(allRight), "--baseline", baseline, "--run", a]);
  const testBaseline = (await command(context, ["run", ...dataset, "--partition", "test", "--tuning", "none"])).run!;
  equal(await runEvalCommand(["tune", "activate", "--run", opened.run!, "--baseline", testBaseline, "--metric", "prediction", "--min-pass", "0.3"], context), 0, context.lines.join("\n"));
  ok(existsSync(certificatePath(context.certificatesFolder(), "hypothesis")));
  const issued = readActiveFile(context.tuningFolder(), "hypothesis")!.active.certificate;
  ok(issued !== null);
  // A rollback stopped after it removed the certificate runs again: the entry keeps the certificate it was activated with.
  rmSync(certificatePath(context.certificatesFolder(), "hypothesis"));
  equal(await runEvalCommand(["tune", "rollback", "--job", "hypothesis"], context), 0);
  equal(existsSync(certificatePath(context.certificatesFolder(), "hypothesis")), false);
  deepStrictEqual(readActiveFile(context.tuningFolder(), "hypothesis")!.rolledBack[0]!.certificate, issued);
  ok(context.lines.some((line) => line === "Rolled back hypothesis to the code's prompt, without a certificate."));
});
