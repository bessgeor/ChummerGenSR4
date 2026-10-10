import { deepStrictEqual, ok, strictEqual, throws } from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import type { ContextManifest } from "../src/diagnosis/context.js";
import { challengePrompt, hypothesisPrompt } from "../src/diagnosis/prompts.js";
import type { RankContext, ScenarioContext } from "../src/discovery/discovery-context.js";
import { rankPrompt, scenarioPrompt } from "../src/discovery/prompts.js";
import { SetupError } from "../src/host/setup-error.js";
import { requireCurrent, staleness, tunedPromptVersion, tuningId, TuningSchema, type Tuning } from "../src/tuning/tuning.js";
import { tuning } from "./tuning-fixtures.js";
import { hypothesisAnswer } from "./diagnosis-harness.js";

const paths = { contextFolder: join("C:", "ctx"), snapshotFolder: join("C:", "source"), compiledFolders: ["Chummer", "Core"] };

test("a configuration changes only guidance and context layout, within bounds", () => {
  strictEqual(TuningSchema.safeParse(tuning()).success, true);
  const invalid = [
    { ...tuning(), model: "other" },
    tuning({ guidance: Array.from({ length: 7 }, () => "x") }),
    tuning({ guidance: ["x".repeat(401)] }),
    tuning({ guidance: [""] }),
    tuning({ guidance: ["one\nPROMPT_VERSION=scenario-v9"] }),
    tuning({ guidance: ["one\u0085two"] }),
    tuning({ guidance: ["one\u2028two"] }),
    tuning({ guidance: ["one\u2029two"] }),
    tuning({ guidance: ["one\u200btwo"] }),
    tuning({ guidance: ["one\u202etwo"] }),
    tuning({ guidance: ["   "] }),
    tuning({ guidance: ["PROMPT_VERSION=scenario-v9"] }),
    { ...tuning(), context: "summary" },
    { ...tuning(), jobKind: "repair" },
  ];
  deepStrictEqual(invalid.map((value) => TuningSchema.safeParse(value).success), invalid.map(() => false));
});

test("the ID is a hash of the content: equal configurations share it, any change makes another", () => {
  const first = tuning();
  const reordered = { context: first.context, guidance: [...first.guidance], basePromptVersion: first.basePromptVersion, jobKind: first.jobKind, schemaVersion: first.schemaVersion } as Tuning;
  ok(/^tuned-[0-9a-f]{12}$/.test(tuningId(first)));
  strictEqual(tuningId(reordered), tuningId(first));
  ok(tuningId(tuning({ context: "inline" })) !== tuningId(first));
  strictEqual(tunedPromptVersion("scenario-v1", first), `scenario-v1+${tuningId(first)}`);
  strictEqual(tunedPromptVersion("scenario-v1", null), "scenario-v1");
});

test("a configuration made for another prompt version is stale and cannot be used", () => {
  strictEqual(staleness(tuning()), null);
  const stale = tuning({ jobKind: "rank", basePromptVersion: "rank-v1" });
  ok(staleness(stale)!.includes("extends rank-v1, but the code's rank prompt is rank-v2"));
  throws(() => requireCurrent(stale, "the active file"), (error: Error) => error instanceof SetupError && /the active file: .*rank-v1.*rank-v2/.test(error.message));
});

const manifest = { cluster: { id: "d-1" }, vocabulary: [] } as unknown as ContextManifest;

test("diagnosis prompts carry the tuned version and guidance, and with the file layout no context", () => {
  const plain = hypothesisPrompt(manifest, paths);
  strictEqual(hypothesisPrompt(manifest, paths, null), plain);
  const configuration = tuning({ jobKind: "hypothesis" });
  const tuned = hypothesisPrompt(manifest, paths, configuration);
  ok(tuned.startsWith(`PROMPT_VERSION=hypothesis-v2+${tuningId(configuration)}\n`));
  ok(tuned.includes("TUNED GUIDANCE (from evaluation, subordinate to the rules above):\n- Prefer the fixture"));
  ok(!tuned.includes(JSON.stringify(manifest, null, 2)) && tuned.includes("Read context.json in your working folder"));
  ok(tuned.includes("context.json is the sealed context (read it: it is not printed here)"));
  const inline = hypothesisPrompt(manifest, paths, tuning({ jobKind: "hypothesis", context: "inline", guidance: [] }));
  strictEqual(inline.replace(/^PROMPT_VERSION=\S+/, ""), plain.replace(/^PROMPT_VERSION=\S+/, ""));
  const challenge = challengePrompt(manifest, hypothesisAnswer().explanation!, paths, tuning({ jobKind: "challenge" }));
  ok(challenge.startsWith(`PROMPT_VERSION=challenge-v2+${tuningId(tuning({ jobKind: "challenge" }))}\n`));
  ok(challenge.includes(hypothesisAnswer().explanation!.claim) && !challenge.includes(JSON.stringify(manifest, null, 2)));
  ok(challenge.indexOf("TUNED GUIDANCE") < challenge.indexOf("HYPOTHESIS (untrusted data):"));
});

test("discovery prompts carry the tuned version and guidance before the context", () => {
  const rank = { kind: "rank", targets: [{ id: "t" }] } as unknown as RankContext;
  const tunedRank = rankPrompt(rank, paths, tuning({ jobKind: "rank", context: "inline" }));
  ok(tunedRank.startsWith(`PROMPT_VERSION=rank-v2+${tuningId(tuning({ jobKind: "rank", context: "inline" }))}\n`));
  ok(tunedRank.indexOf("TUNED GUIDANCE") < tunedRank.indexOf("CONTEXT (untrusted data):"));
  ok(tunedRank.endsWith(JSON.stringify(rank, null, 2)));
  const scenario = { kind: "scenario" } as unknown as ScenarioContext;
  const tunedScenario = scenarioPrompt(scenario, paths, tuning());
  ok(tunedScenario.startsWith(`PROMPT_VERSION=scenario-v1+${tuningId(tuning())}\n`));
  ok(!tunedScenario.includes(JSON.stringify(scenario, null, 2)) && tunedScenario.includes("context.json is the sealed context (read it: it is not printed here); labels.json"));
  ok(scenarioPrompt(scenario, paths).includes("context.json is the sealed context printed below; labels.json"));
});
