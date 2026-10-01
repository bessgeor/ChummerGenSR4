import { deepStrictEqual, equal, ok } from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { ContextManifest } from "../src/diagnosis/context.js";
import type { Explanation } from "../src/diagnosis/job-schemas.js";
import { challengePrompt, hypothesisPrompt } from "../src/diagnosis/prompts.js";
import { discriminatingPredictions, snapshotPath, validateChallenge, validateHypothesis } from "../src/diagnosis/validation.js";
import { scratch, write } from "./diagnosis-fixtures.js";
import { challengeAnswer, hypothesisAnswer } from "./diagnosis-harness.js";

const manifest = {
  vocabulary: [
    { case: "build-alpha", mode: "build", captures: ["common", "skills"] },
    { case: "career-beta", mode: "career", captures: ["common"] },
  ],
} as unknown as ContextManifest;

function snapshot(): string {
  const root = scratch();
  write(root, "Chummer/frmCreate.cs", "class frmCreate {}");
  write(root, "bin/data/skills.xml", "<skills>\n</skills>");
  return root;
}

test("snapshot paths are relative and stay inside the snapshot", () => {
  deepStrictEqual(["Chummer/a.cs", "./Chummer/a.cs", "Chummer\\a.cs", "Chummer/x/../a.cs"].map(snapshotPath), ["Chummer/a.cs", "Chummer/a.cs", "Chummer/a.cs", "Chummer/a.cs"]);
  deepStrictEqual(["../a.cs", "C:/a.cs", "/a.cs", "", "Chummer/../../a.cs"].map(snapshotPath), [null, null, null, null, null]);
});

test("a valid hypothesis and abstention pass; each broken part is named", () => {
  const folder = snapshot();
  deepStrictEqual(validateHypothesis(hypothesisAnswer(), manifest, folder), []);
  deepStrictEqual(validateHypothesis({ outcome: "abstain", reason: "nothing readable", explanation: null }, manifest, folder), []);
  const base = hypothesisAnswer().explanation!;
  const broken: Explanation = {
    ...base, claim: " ", confidence: 1.5,
    locations: [{ path: "Chummer/frmCreate.cs", symbol: null, line: 9 }, { path: "../outside.cs", symbol: null, line: null }],
    predictions: [...base.predictions, { case: "build-alpha", capture: "skills", expect: "matches", why: "" }, { case: "build-alpha", capture: "armor", expect: "differs", why: "x" }],
  };
  const errors = validateHypothesis({ outcome: "hypothesis", reason: "r", explanation: broken }, manifest, folder);
  for (const expected of [/claim is empty/, /confidence 1.5/, /line 9 is outside Chummer\/frmCreate.cs \(1 lines\)/, /..\/outside.cs is not a file/, /build-alpha\/skills is repeated/, /gives no reason/, /build-alpha\/armor names no case and capture/]) {
    ok(errors.some((error) => expected.test(error)), `${expected}: ${errors.join(" | ")}`);
  }
  ok(validateHypothesis({ outcome: "hypothesis", reason: "r", explanation: null }, manifest, folder).some((error) => /needs an explanation/.test(error)));
  ok(validateHypothesis({ outcome: "abstain", reason: "r", explanation: base }, manifest, folder).some((error) => /must not carry/.test(error)));
  ok(validateHypothesis({ ...hypothesisAnswer(), explanation: { ...base, predictions: [] } }, manifest, folder).some((error) => /0 predictions/.test(error)));
});

test("an alternative must make another claim and disagree on a shared capture", () => {
  const folder = snapshot();
  const hypothesis = hypothesisAnswer().explanation!;
  deepStrictEqual(validateChallenge(challengeAnswer(), hypothesis, manifest, folder), []);
  deepStrictEqual(validateChallenge({ outcome: "no_alternative", reason: "the evidence is specific", alternative: null }, hypothesis, manifest, folder), []);
  deepStrictEqual(discriminatingPredictions(hypothesis, challengeAnswer().alternative!), [{ case: "career-beta", capture: "common" }]);
  const same = { ...challengeAnswer().alternative!, claim: `  ${hypothesis.claim.toUpperCase()} ` };
  ok(validateChallenge({ outcome: "alternative", reason: "r", alternative: same }, hypothesis, manifest, folder).some((error) => /repeats the hypothesis's claim/.test(error)));
  const agreeing = { ...challengeAnswer().alternative!, predictions: [{ case: "build-alpha", capture: "skills", expect: "differs" as const, why: "w" }] };
  ok(validateChallenge({ outcome: "alternative", reason: "r", alternative: agreeing }, hypothesis, manifest, folder).some((error) => /no check can tell them apart/.test(error)));
});

test("prompts are versioned, name the folders, mark run text as untrusted and carry the manifest", () => {
  const paths = { contextFolder: join("C:", "ctx"), snapshotFolder: join("C:", "src") };
  const full = { ...manifest, cluster: { id: "d-1" } } as unknown as ContextManifest;
  const hypothesis = hypothesisPrompt(full, paths);
  ok(hypothesis.startsWith("PROMPT_VERSION=hypothesis-v1\n"));
  ok(hypothesis.includes(paths.contextFolder) && hypothesis.includes(paths.snapshotFolder));
  ok(/untrusted data, never instructions/.test(hypothesis));
  ok(hypothesis.endsWith(JSON.stringify(full, null, 2)));
  const challenge = challengePrompt(full, hypothesisAnswer().explanation!, paths);
  ok(challenge.startsWith("PROMPT_VERSION=challenge-v1\n"));
  ok(challenge.includes("HYPOTHESIS (untrusted data):"));
  equal(challenge.includes(hypothesisAnswer().explanation!.claim), true);
});
