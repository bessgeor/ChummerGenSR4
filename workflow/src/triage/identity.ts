import type { BaseStore } from "@langchain/langgraph-checkpoint";
import { z } from "zod";
import { sha256Text } from "../steps/fingerprint.js";
import { minimumPositionMatch, positionMatch, type Cluster } from "./clusters.js";

const rect = z.strictObject({ x: z.number(), y: z.number(), width: z.number(), height: z.number() });

/** What the store keeps about a discrepancy identity, under `["discrepancy", <image hash>]`. */
export const IdentityRecordSchema = z.strictObject({
  core: rect,
  captureSize: z.strictObject({ width: z.number(), height: z.number() }),
  case: z.string(),
  capture: z.string(),
  firstThread: z.string(),
  firstSeenUtc: z.string(),
});

export type Identity = { readonly id: string; readonly known: boolean };

export function namespaceFor(imageHash: string): string[] {
  return ["discrepancy", imageHash];
}

/** The identity derived from the image hash and the representative's core; `attempt` tells apart ids that would collide. */
export function newIdentityId(cluster: Cluster, attempt = 0): string {
  const { core } = cluster.members[0]!;
  const suffix = attempt === 0 ? "" : `:${attempt}`;
  return `d-${sha256Text(`${cluster.imageHash}:${core.x},${core.y},${core.width},${core.height}${suffix}`).slice(0, 16)}`;
}

/**
 * Gives each cluster a stable identity: a stored identity with the same image hash whose core matches the
 * cluster's representative at 97 % or more is reused; otherwise a new one is derived and stored. An identity
 * the same thread stored on an earlier, unfinished triage keeps its id and is reported as new.
 */
export async function assignIdentities(clusters: readonly Cluster[], store: BaseStore, threadId: string, now: Date): Promise<Identity[]> {
  const assigned = new Set<string>();
  const identities: Identity[] = [];
  for (const cluster of clusters) {
    const representative = cluster.members[0]!;
    const stored = await store.search(namespaceFor(cluster.imageHash), { limit: 10_000 });
    let firstSeenHere = false;
    const match = stored.find((item) => {
      const record = IdentityRecordSchema.parse(item.value);
      const matches = !assigned.has(item.key) && positionMatch(record, representative) >= minimumPositionMatch;
      firstSeenHere = matches && record.firstThread === threadId;
      return matches;
    });
    if (match !== undefined) {
      assigned.add(match.key);
      // An identity this thread stored itself (triage ran before and did not finish) is still new to the thread.
      identities.push({ id: match.key, known: !firstSeenHere });
      continue;
    }
    // The derived id may already name another identity (one that matched a cluster of another capture size), and a
    // stored identity must never be overwritten.
    let id = newIdentityId(cluster);
    for (let attempt = 1; assigned.has(id) || (await store.get(namespaceFor(cluster.imageHash), id)) !== null; attempt++) {
      id = newIdentityId(cluster, attempt);
    }
    await store.put(namespaceFor(cluster.imageHash), id, IdentityRecordSchema.parse({
      core: representative.core, captureSize: representative.captureSize, case: representative.case,
      capture: representative.capture, firstThread: threadId, firstSeenUtc: now.toISOString(),
    }));
    assigned.add(id);
    identities.push({ id, known: false });
  }
  return identities;
}
