import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { resolveAgentSettings } from "../src/agents/agent-settings.js";
import { certificatePath, certificateProblems, certify, unattendedProblems, type Certificate } from "../src/evals/certificate.js";
import { runEvalCommand } from "../src/evals/eval-commands.js";
import { parseArguments } from "../src/options/arguments.js";
import { resolveRunOptions, type RunOptions } from "../src/options/run-options.js";
import { workflowPaths } from "../src/paths.js";
import { dispatchedJobKinds } from "../src/tuning/tuning.js";
import { scratch } from "./diagnosis-fixtures.js";
import { diagnosisHarness, FakeAgents, twoClusters } from "./diagnosis-harness.js";
import { evalContext } from "./eval-fixtures.js";
import { writeRun } from "./eval-threads.js";

const now = new Date("2026-10-02T13:00:00Z");

test("a certificate is issued when the interval's lower bound meets the threshold, and names the configuration", () => {
  const root = scratch("workflow-certify-");
  writeRun(join(root, "runs", "er-1"), {}, Array.from({ length: 20 }, () => true));
  const outcome = certify(join(root, "runs", "er-1"), { metric: "prediction", minPass: 0.8, maxMeanCostUsd: null }, join(root, "certificates"), now);
  ok("certificate" in outcome);
  const certificate = outcome.certificate;
  deepStrictEqual([certificate.jobKind, certificate.agent, certificate.promptVersion, certificate.run, certificate.items, certificate.passes, certificate.rate],
    ["hypothesis", { provider: "claude", model: null, effort: "medium" }, "hypothesis-v2", "er-1", 20, 20, 1]);
  ok(certificate.interval.low > 0.83 && certificate.interval.low < 0.84);
  equal(certificate.meanCostUsd, null);
  deepStrictEqual(JSON.parse(readFileSync(certificatePath(join(root, "certificates"), "hypothesis"), "utf8")), certificate);
});

test("repetitions of an item are one sample: ten items repeated five times certify like ten items", () => {
  const root = scratch("workflow-certify-");
  writeRun(join(root, "runs", "ten"), {}, Array.from({ length: 10 }, () => true), 5);
  const outcome = certify(join(root, "runs", "ten"), { metric: "prediction", minPass: 0.75, maxMeanCostUsd: null }, join(root, "certificates"), now);
  // Fifty samples would give a lower bound of 0.929; the ten items give 0.722.
  ok("refused" in outcome && /lower bound 0.72\d of the 95% interval of prediction \(10.00\/10 items\)/.test(outcome.refused.join()), JSON.stringify(outcome));
  const issued = certify(join(root, "runs", "ten"), { metric: "prediction", minPass: 0.7, maxMeanCostUsd: null }, join(root, "certificates"), now);
  ok("certificate" in issued);
  equal(issued.certificate.items, 10);
});

test("a certificate is refused for a small sample, another partition, an incomplete run or an unknown or high cost, and nothing is written", async () => {
  const root = scratch("workflow-certify-");
  const certificates = join(root, "certificates");
  const refused = (run: string, minPass: number, maxMeanCostUsd: number | null = null) => {
    const outcome = certify(join(root, "runs", run), { metric: "prediction", minPass, maxMeanCostUsd }, certificates, now);
    return "refused" in outcome ? outcome.refused.join("\n") : "";
  };
  writeRun(join(root, "runs", "three"), {}, [true, true, true]);
  match(refused("three", 0.8), /lower bound 0.43\d of the 95% interval of prediction \(3\.00\/3 items\) is below 0.8/);
  writeRun(join(root, "runs", "development"), { partition: "development" }, Array.from({ length: 20 }, () => true));
  match(refused("development", 0.5), /development partition, not test/);
  writeRun(join(root, "runs", "incomplete"), {}, Array.from({ length: 20 }, () => true));
  rmSync(join(root, "runs", "incomplete", "samples", "i3-1.json"));
  match(refused("incomplete", 0.5), /not complete: 1 samples are missing/);
  // The first sample of a written run has no reported cost; the others cost 0.1 USD.
  match(refused("three", 0.1, 1), /1 samples have no reported cost/);
  writeRun(join(root, "runs", "costly"), {}, Array.from({ length: 20 }, () => true));
  rmSync(join(root, "runs", "costly", "samples", "i0-1.json"));
  writeFileSync(join(root, "runs", "costly", "run.json"), readFileSync(join(root, "runs", "costly", "run.json"), "utf8").replace("\"i0-1\",", ""));
  match(refused("costly", 0.5, 0.05), /mean cost 0.1000 USD is above 0.05/);
  equal(existsSync(certificates), false);
  const context = evalContext({ certificatesFolder: () => certificates, paths: { ...workflowPaths(root), evalsFolder: root } });
  equal(await runEvalCommand(["certify", "--run", "three", "--metric", "prediction", "--min-pass", "0.8"], context), 1);
  match(context.lines.join("\n"), /Certificate refused:/);
  equal(await runEvalCommand(["certify", "--run", "three", "--metric", "prediction", "--min-pass", "0.4"], context), 0);
  ok(existsSync(certificatePath(certificates, "hypothesis")));
});

function writeCertificate(folder: string, jobKind: "hypothesis" | "challenge", overrides: Partial<Certificate> = {}): void {
  const certificate: Certificate = {
    schemaVersion: 1, jobKind, agent: { provider: jobKind === "hypothesis" ? "claude" : "codex", model: null, effort: "medium" },
    promptVersion: `${jobKind}-v2`, run: "er-1", dataset: { name: "d", version: 1, hash: "h", partition: "test" }, metric: "prediction",
    items: 20, passes: 20, rate: 1, interval: { low: 0.84, high: 1 }, thresholds: { minPass: 0.8, maxMeanCostUsd: null }, meanCostUsd: null, issuedUtc: "t",
    ...overrides,
  };
  mkdirSync(folder, { recursive: true });
  writeFileSync(certificatePath(folder, jobKind), JSON.stringify(certificate));
}

test("the gate names each job kind without a valid certificate for the run's configuration", () => {
  const folder = join(scratch("workflow-gate-"), "certificates");
  const settings = resolveAgentSettings(undefined);
  deepStrictEqual(certificateProblems(folder, ["hypothesis", "challenge"], settings).map((line) => line.split(" (")[0]), ["hypothesis: no certificate", "challenge: no certificate"]);
  writeCertificate(folder, "hypothesis", { agent: { provider: "claude", model: null, effort: "low" } });
  writeFileSync(certificatePath(folder, "challenge"), "{");
  const problems = certificateProblems(folder, ["hypothesis", "challenge"], settings);
  match(problems[0]!, /hypothesis: the certificate is for effort low, the run uses medium/);
  match(problems[1]!, /challenge: the certificate .* cannot be read/);
  writeCertificate(folder, "challenge", { jobKind: "hypothesis" });
  match(certificateProblems(folder, ["challenge"], settings)[0]!, /invalid \(it is for hypothesis\)/);
  writeCertificate(folder, "challenge", { promptVersion: "challenge-v0" });
  match(certificateProblems(folder, ["challenge"], settings)[0]!, /prompt version challenge-v0, the run uses challenge-v2/);
  writeCertificate(folder, "hypothesis");
  writeCertificate(folder, "challenge");
  deepStrictEqual(certificateProblems(folder, ["hypothesis", "challenge"], settings), []);
  // Stored options that do not state `unattended` are not unattended, whatever the certificates say.
  const options = { diagnosis: true, only: null, repair: null, certificates: join(folder, "none"), agents: settings };
  deepStrictEqual(unattendedProblems(options as unknown as RunOptions), []);
  equal(unattendedProblems({ ...options, unattended: true } as unknown as RunOptions).length, 2);
  deepStrictEqual(dispatchedJobKinds({ diagnosis: false, only: null }), []);
  deepStrictEqual(dispatchedJobKinds({ diagnosis: true, only: "triage" }), []);
  deepStrictEqual(dispatchedJobKinds({ diagnosis: true, only: "diagnose" }), ["hypothesis", "challenge"]);
});

test("npm start --unattended refuses before any step without certificates, runs with them, and checks again on resume", async () => {
  const refused = diagnosisHarness({ spots: twoClusters });
  equal(await refused.start({ unattended: true }), 3);
  match(refused.lines.join("\n"), /--unattended needs a certificate[\s\S]*hypothesis: no certificate[\s\S]*challenge: no certificate/);
  ok(!refused.lines.some((line) => line.startsWith("Thread ")));
  equal(refused.agents.calls.length, 0);

  const withoutDiagnosis = diagnosisHarness({ spots: twoClusters });
  equal(await withoutDiagnosis.start({ unattended: true, noDiagnosis: true }), 1);

  // A hypothesis job fails with infra once, so the thread stops and is resumed.
  const agents = new FakeAgents((call, attempt) => (call.kind === "hypothesis" && attempt === 1 ? { failure: { kind: "infra", message: "crash" } } : { answer: call.kind === "hypothesis" ? { outcome: "abstain", reason: "r", explanation: null } : {} }));
  const certified = diagnosisHarness({ spots: twoClusters, agents });
  const certificates = join(certified.root, "certificates");
  writeCertificate(certificates, "hypothesis");
  writeCertificate(certificates, "challenge");
  equal(await certified.start({ unattended: true }), 3);
  const threadId = certified.threadId();
  ok(agents.calls.length > 0);
  rmSync(certificatePath(certificates, "challenge"));
  equal(await certified.resume(threadId), 3);
  match(certified.lines.join("\n"), /challenge: no certificate/);
  writeCertificate(certificates, "challenge");
  // Every cluster abstains; the captures' visual differences give status 1.
  equal(await certified.resume(threadId), 1);
});

test("--unattended is parsed and kept in the options with the certificates folder of the profile", () => {
  const command = parseArguments(["--unattended", "--case", "a"]);
  ok(command.kind === "start" && command.arguments.unattended);
  if (command.kind !== "start") return;
  const options = resolveRunOptions(command.arguments, {}, { LOCALAPPDATA: "C:\\data" }, "C:\\repo");
  deepStrictEqual([options.unattended, options.certificates], [true, join("C:\\repo", "workflow", "evals", "certificates")]);
  equal(resolveRunOptions(command.arguments, { certificates: "D:\\certs" }, { LOCALAPPDATA: "C:\\data" }, "C:\\repo").certificates, "D:\\certs");
  equal(resolveRunOptions({ ...command.arguments, unattended: false }, {}, { LOCALAPPDATA: "C:\\data" }, "C:\\repo").unattended, false);
});