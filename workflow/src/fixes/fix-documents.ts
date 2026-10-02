import type { FixLevel, FixRecord, FixRun } from "./fix-record.js";

/** Untrusted text on one line, so that it cannot open a heading, a list or a code block of its own. */
function inline(text: string | null): string {
  if (text === null) return "(none)";
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length === 0 ? "(empty)" : `"${flat.replaceAll("`", "'")}"`;
}

function code(text: string): string {
  return `\`${text.replaceAll("`", "'")}\``;
}

function run(item: FixRun): string {
  return `run ${code(item.run)}: execution status ${item.status}, coverage ${item.coverageValid ? "valid" : "invalid"}, ${item.failures} failures; `
    + `visual ${item.passed} passed, ${item.failed} failed`;
}

/** `proposal.md`: the discrepancy, the hypothesis and the evidence that confirmed it. */
export function renderProposal(record: FixRecord): string {
  const { cluster, hypothesis, challenge, check } = record;
  // The record holds the sealed members only, which are fewer than the cluster's when the cluster is large.
  const listed = record.members.map((member) => `${member.case}/${member.capture}`).join(", ");
  const places = record.members.length < cluster.members ? `${record.members.length} listed: ${listed}` : listed;
  const lines = [
    `# Fix ${cluster.id}`,
    "",
    "## Why",
    "",
    `The candidate differs from the canonical executable in the raw pixels of ${cluster.members} ${cluster.members === 1 ? "capture" : "captures"} (${places}). `
      + `Hypothesis: ${inline(hypothesis.claim)}`,
    "",
    "## What Changes",
    "",
    inline(record.plan.summary),
    "",
    ...record.patch.files.map((file) => `- ${code(file.path)} ${file.change}, ${file.added} ${file.added === 1 ? "line" : "lines"} added, ${file.removed} removed`),
    "",
    "## Discrepancy",
    "",
    `- Cluster ${code(cluster.id)}, image hash ${code(cluster.imageHash)}, ${cluster.members} ${cluster.members === 1 ? "member" : "members"} `
      + `in ${cluster.cases.length === 1 ? "the case" : "the cases"} ${cluster.cases.map(code).join(", ")} and ${cluster.captures.length === 1 ? "the capture" : "the captures"} ${cluster.captures.map(code).join(", ")}.`,
    ...record.members.map((member) => `- ${code(`${member.case}/${member.capture}`)}: change core at (${member.core.x}, ${member.core.y}), `
      + `${member.core.width} x ${member.core.height}, ${member.differingPixels} differing pixels; OCR canonical ${inline(member.canonicalOcr)}, candidate ${inline(member.candidateOcr)}.`),
    "",
    "## Hypothesis",
    "",
    `- Claim: ${inline(hypothesis.claim)}`,
    `- Mechanism: ${hypothesis.mechanism}; confidence ${hypothesis.confidence}; record ${code(hypothesis.recordId)}.`,
    ...hypothesis.locations.map((location) => `- Location: ${code(location.path)}${location.symbol === null ? "" : ` ${code(location.symbol)}`}${location.line === null ? "" : ` line ${location.line}`}`),
    `- Evidence: ${inline(hypothesis.evidence)}`,
    "",
    "## Evidence",
    "",
    challenge === null ? "- Challenge: none."
      : `- Challenge (record ${code(challenge.recordId)}): ${challenge.outcome}: ${inline(challenge.reason)}${challenge.alternative === null ? "" : `; alternative ${inline(challenge.alternative)}`}`,
    `- Check run ${code(check.run)}: ${check.outcome}.`,
    ...check.observations.map((item) => `  - ${code(`${item.case}/${item.capture}`)} ${item.observation}: ${inline(item.detail)}`),
    `- Plan (record ${code(record.plan.recordId)}): ${inline(record.plan.reason)}`,
    "",
  ];
  return lines.join("\n");
}

/** `tasks.md`: one checked task per subtask, with its files, blockers and record. */
export function renderTasks(record: FixRecord): string {
  const lines = ["# Tasks", "", "## 1. Subtasks", ""];
  for (const task of record.tasks) {
    const blockers = task.blockedBy.length === 0 ? "none" : task.blockedBy.map((id) => `1.${id}`).join(", ");
    lines.push(`- [x] 1.${task.id} ${inline(task.title)}. Files: ${task.files.map(code).join(", ")}. Blocked by: ${blockers}. `
      + `Record: ${code(task.recordId)}. Done: ${inline(task.summary)}`);
  }
  lines.push("");
  return lines.join("\n");
}

function level(item: FixLevel): string[] {
  const lines = [
    `### ${item.level}`,
    "",
    `- Cases: ${item.cases.length === 0 ? "none" : item.cases.map(code).join(", ")}; captures: ${item.captures === null ? "all" : item.captures.map(code).join(", ")}.`,
    item.run === null ? "- Nothing new to capture." : `- Level ${run(item.run)}.`,
  ];
  if (item.baseline !== null) lines.push(`- Baseline ${run(item.baseline)}.`);
  lines.push(item.findings.length === 0 ? "- Findings: none." : "- Findings:");
  for (const finding of item.findings) {
    lines.push(`  - ${code(`${finding.case}/${finding.capture}`)} ${finding.attribution} (difference ${finding.difference}): ${inline(finding.detail)}`);
  }
  lines.push(`- Outcome: ${item.outcome}.`, "");
  return lines;
}

/** `verification.md`: the narrow check and each widening level, execution apart from the visual result. */
export function renderVerification(record: FixRecord): string {
  if (record.widening === null) throw new Error(`The fix change ${record.name} has no widening to verify it.`);
  return [
    "# Verification",
    "",
    "## Narrow check",
    "",
    `- ${run(record.narrowCheck)}.`,
    "",
    "## Widening",
    "",
    ...record.widening.flatMap(level),
  ].join("\n");
}

/** Every file of a complete fix change, by its name in the change folder. */
export function fixChangeFiles(record: FixRecord): Record<string, string> {
  return {
    "proposal.md": renderProposal(record),
    "tasks.md": renderTasks(record),
    "verification.md": renderVerification(record),
    "fix.json": `${JSON.stringify(record, null, 2)}\n`,
  };
}
