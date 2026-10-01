import { deepStrictEqual, equal, match, ok } from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { test } from "node:test";
import { join } from "node:path";
import { getRecord, listRecords } from "../src/evals/eval-record.js";
import type { BenchmarkItem } from "../src/evals/benchmark.js";
import { createReviewServer } from "../src/review/review-server.js";
import { diagnosisHarness, twoClusters } from "./diagnosis-harness.js";

/** A review server on a free port over a finished fixture thread. */
async function served(items: BenchmarkItem[] = []) {
  const harness = diagnosisHarness({ spots: twoClusters });
  equal(await harness.start(), 1);
  const threadId = harness.threadId();
  const lines: string[] = [];
  const server = createReviewServer({
    store: harness.store, threadFolder: (id) => join(harness.root, "threads", id), benchmark: () => items,
    queue: { seed: "review", perStratum: 3 }, reviewer: "tester", now: () => new Date("2026-10-02T10:00:00Z"), log: (line) => lines.push(line),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = (path: string) => fetch(`${base}${path}`, { redirect: "manual" });
  const post = (form: Record<string, string>) => fetch(`${base}/verdict`, { method: "POST", body: new URLSearchParams(form), redirect: "manual" });
  return { harness, threadId, server, get, post, lines, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

test("the queue page lists every queued record and the record page shows evidence, answer, check and verdict form", async () => {
  const page = await served();
  try {
    const hypothesis = `${page.threadId}/d-0000000000000100/hypothesis/1`;
    const queue = await page.get("/");
    equal(queue.status, 200);
    const html = await queue.text();
    match(html, /4 records wait for a verdict; 0 reviewed/);
    ok(html.includes(encodeURIComponent(hypothesis)));
    const record = await page.get(`/record?id=${encodeURIComponent(hypothesis)}`);
    equal(record.status, 200);
    const detail = await record.text();
    for (const text of ["evidence%2F1-canonical.png", "evidence%2F1-candidate.png", "canvas data-left", "The Skills tab label moved in frmCreate.",
      "&quot;outcome&quot;: &quot;confirmed&quot;", "name=verdict value=correct", "name=verdict value=unclear", "Free Knowledge Skill Points Remaining:"]) {
      ok(detail.includes(text), text);
    }
    const challenge = await (await page.get(`/record?id=${encodeURIComponent(`${page.threadId}/d-0000000000000100/challenge/1`)}`)).text();
    match(challenge, /Challenged hypothesis/);
  } finally {
    await page.close();
  }
});

test("the evidence route serves only the crops the manifest lists", async () => {
  const page = await served();
  try {
    const id = encodeURIComponent(`${page.threadId}/d-0000000000000100/hypothesis/1`);
    const crop = await page.get(`/evidence?id=${id}&file=${encodeURIComponent("evidence/1-canonical.png")}`);
    equal(crop.status, 200);
    equal(crop.headers.get("content-type"), "image/png");
    match(await crop.text(), /^canonical /);
    for (const file of ["../context.json", "context.json", "evidence/../context.json", "evidence\\1-canonical.png", "../../diagnosis.json", ""]) {
      equal((await page.get(`/evidence?id=${id}&file=${encodeURIComponent(file)}`)).status, 404, file);
    }
    equal((await page.get(`/evidence?id=nope&file=${encodeURIComponent("evidence/1-canonical.png")}`)).status, 404);
  } finally {
    await page.close();
  }
});

test("a verdict is stored with the reviewer and leads to the next queued record; an invalid verdict and an unknown record write nothing", async () => {
  const page = await served();
  try {
    const id = `${page.threadId}/d-0000000000000100/hypothesis/1`;
    const before = JSON.stringify(await listRecords(page.harness.store));
    equal((await page.post({ id, verdict: "maybe" })).status, 400);
    equal((await page.post({ id: "unknown", verdict: "correct" })).status, 404);
    equal((await page.get("/record?id=unknown")).status, 404);
    equal((await page.get("/elsewhere")).status, 404);
    equal(JSON.stringify(await listRecords(page.harness.store)), before);

    const response = await page.post({ id, verdict: "correct", note: "  The label's X moved.  " });
    equal(response.status, 303);
    const next = decodeURIComponent(response.headers.get("location")!.replace("/record?id=", ""));
    ok(next !== id && next.startsWith(page.threadId), next);
    const stored = await getRecord(page.harness.store, "hypothesis", id);
    deepStrictEqual(stored.labels.review, { verdict: "correct", note: "The label's X moved.", reviewer: "tester", reviewedUtc: "2026-10-02T10:00:00.000Z" });
    equal(stored.labels.check, "confirmed");
    deepStrictEqual(page.lines, [`Review: ${id} correct (The label's X moved.).`]);
    match(await (await page.get("/")).text(), /3 records wait for a verdict; 1 reviewed/);
  } finally {
    await page.close();
  }
});
