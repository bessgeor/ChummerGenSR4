import type { ContextManifest } from "../diagnosis/context.js";
import type { BenchmarkItem } from "../evals/benchmark.js";
import { verdicts, type EvalRecord } from "../evals/eval-record.js";
import type { QueueEntry } from "../evals/review-queue.js";
import type { CheckView } from "./cluster-check.js";

export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll("\"", "&quot;").replaceAll("'", "&#39;");
}

const style = `body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:80rem}table{border-collapse:collapse}td,th{padding:.25rem .6rem;border-bottom:1px solid #ddd;text-align:left}
.crops{display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start}.crops figure{margin:0}.crops img,.crops canvas{border:1px solid #888;image-rendering:pixelated;max-width:36rem}
pre{background:#f6f6f6;padding:.6rem;overflow:auto;white-space:pre-wrap}.verdict button{font-size:1rem;margin-right:.5rem}.flag{color:#b00}`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${style}</style></head><body>${body}</body></html>`;
}

export function recordLink(recordId: string): string {
  return `/record?id=${encodeURIComponent(recordId)}`;
}

function evidenceLink(recordId: string, file: string): string {
  return `/evidence?id=${encodeURIComponent(recordId)}&file=${encodeURIComponent(file)}`;
}

/** The queue: each waiting record with why it is queued and its labels. */
export function queuePage(queue: readonly QueueEntry[], reviewed: number): string {
  const rows = queue.map(({ record, reason }) => `<tr><td>${reason === "disagreement" ? "<span class=flag>disagreement</span>" : "sample"}</td>`
    + `<td><a href="${recordLink(record.recordId)}">${escapeHtml(record.recordId)}</a></td><td>${record.jobKind}</td><td>${record.labels.check ?? "-"}</td>`
    + `<td>${record.labels.hindsight?.grade ?? "-"}</td><td>${record.labels.grader?.score ?? "-"}</td></tr>`).join("");
  return page("Review queue", `<h1>Review queue</h1><p>${queue.length} records wait for a verdict; ${reviewed} reviewed.</p>`
    + `<table><tr><th>Why</th><th>Record</th><th>Job</th><th>Check</th><th>Hindsight</th><th>Grader</th></tr>${rows}</table>`);
}

/** Draws each member's pixel difference from its two crops: changed pixels red, unchanged ones dimmed. */
const differenceScript = `<script>
for (const canvas of document.querySelectorAll("canvas[data-left]")) {
  const load = (src) => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src; });
  Promise.all([load(canvas.dataset.left), load(canvas.dataset.right)]).then(([left, right]) => {
    const width = Math.max(left.width, right.width), height = Math.max(left.height, right.height);
    canvas.width = width; canvas.height = height;
    const pixels = (image) => { const scratch = document.createElement("canvas"); scratch.width = width; scratch.height = height;
      const context = scratch.getContext("2d"); context.drawImage(image, 0, 0); return context.getImageData(0, 0, width, height).data; };
    const a = pixels(left), b = pixels(right), context = canvas.getContext("2d"), out = context.createImageData(width, height);
    let changed = 0;
    for (let i = 0; i < a.length; i += 4) {
      const differs = a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2] || a[i + 3] !== b[i + 3];
      if (differs) { changed++; out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 0; }
      else { const grey = 128 + (a[i] + a[i + 1] + a[i + 2]) / 6; out.data[i] = out.data[i + 1] = out.data[i + 2] = grey; }
      out.data[i + 3] = 255;
    }
    context.putImageData(out, 0, 0);
    canvas.nextElementSibling.textContent = changed + " changed pixels";
  });
}
</script>`;

export type RecordView = {
  readonly record: EvalRecord;
  readonly manifest: ContextManifest;
  /** For a challenge: the hypothesis it challenged. */
  readonly hypothesis: unknown;
  /** The cluster's check from the thread's `diagnosis.json`, or why there is none. */
  readonly check: CheckView;
  /** The token the verdict form carries: a form of another page cannot know it. */
  readonly verdictToken: string;
  readonly items: readonly BenchmarkItem[];
  readonly position: number | null;
  readonly queued: number;
};

function json(value: unknown): string {
  return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
}

/** One record: the crops and their difference, OCR, the answer, the check, a fix's patch, the labels and the verdict form. */
export function recordPage(view: RecordView): string {
  const { record, manifest } = view;
  const members = manifest.members.map((member) => {
    const left = evidenceLink(record.recordId, member.canonicalCrop);
    const right = evidenceLink(record.recordId, member.candidateCrop);
    return `<h3>${escapeHtml(`${member.case} / ${member.capture}`)} (${member.differingPixels} differing pixels)</h3><div class=crops>`
      + `<figure><img src="${left}" alt="canonical crop"><figcaption>canonical; OCR: ${escapeHtml(member.canonicalOcr.text ?? member.canonicalOcr.status)}</figcaption></figure>`
      + `<figure><img src="${right}" alt="candidate crop"><figcaption>candidate; OCR: ${escapeHtml(member.candidateOcr.text ?? member.candidateOcr.status)}</figcaption></figure>`
      + `<figure><canvas data-left="${left}" data-right="${right}"></canvas><figcaption>difference</figcaption></figure></div>`;
  }).join("");
  const labels = record.labels;
  const patches = view.items.map((item) => `<h3>Benchmark item ${escapeHtml(item.itemId)} (${item.kind}, ${item.fix.mechanism})</h3><pre>${escapeHtml(item.fix.patch)}</pre>`).join("");
  const buttons = verdicts.map((verdict) => `<button name=verdict value=${verdict}>${verdict}</button>`).join("");
  return page(record.recordId, `<p><a href="/">Queue</a>${view.position === null ? "" : ` · ${view.position + 1} of ${view.queued}`}</p>`
    + `<h1>${escapeHtml(record.recordId)}</h1>`
    + `<p>${record.jobKind} by ${record.agent.provider} (${escapeHtml(record.agent.model ?? "default model")}, effort ${record.agent.effort}), prompt ${escapeHtml(record.promptVersion)}; `
    + `check ${labels.check ?? "-"}; hindsight ${labels.hindsight === null ? "-" : `${labels.hindsight.grade} (${escapeHtml(labels.hindsight.item)})`}; `
    + `review ${labels.review === null ? "-" : `${labels.review.verdict} by ${escapeHtml(labels.review.reviewer)}`}</p>`
    + (labels.grader === null ? "" : `<p>Grader (advisory): ${labels.grader.score}. ${escapeHtml(labels.grader.rationale)}</p>`)
    + `<form class=verdict method=post action="/verdict"><input type=hidden name=id value="${escapeHtml(record.recordId)}">`
    + `<input type=hidden name=token value="${escapeHtml(view.verdictToken)}">`
    + `<p>${buttons}</p><p><textarea name=note rows=2 cols=80 placeholder="note (optional)"></textarea></p></form>`
    + `<h2>Evidence</h2>${members}`
    + (view.hypothesis === null ? "" : `<h2>Challenged hypothesis</h2>${json(view.hypothesis)}`)
    + `<h2>Answer</h2>${json(record.output)}`
    + `<h2>Check</h2>${"absent" in view.check ? `<p>No check to show: ${escapeHtml(view.check.absent)}</p>` : json(view.check.value)}`
    + (patches.length === 0 ? "" : `<h2>Accepted fix</h2>${patches}`)
    + differenceScript);
}
