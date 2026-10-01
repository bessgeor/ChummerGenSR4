import type { PixelRect } from "../../../contracts/generated/typescript/parity-compare-report.js";

export type Size = { readonly width: number; readonly height: number };

/** One discrepancy from a case's report, with what triage needs to place it. */
export type Member = {
  readonly case: string;
  readonly capture: string;
  readonly runFolder: string;
  readonly discrepancy: string;
  readonly imageHash: string;
  readonly core: PixelRect;
  readonly crop: PixelRect;
  readonly captureSize: Size;
  readonly differingPixels: number;
  readonly canonicalCrop: string;
  readonly candidateCrop: string;
};

export type Cluster = { readonly imageHash: string; readonly members: Member[] };

/** The comparer's threshold for "nearly the same place". */
export const minimumPositionMatch = 97;

function coordinate(left: number, right: number, extent: number): number {
  return Math.min(100, Math.max(0, 100 * (1 - Math.abs(left - right) / Math.max(1, extent))));
}

/**
 * The comparer's position match: the mean of the four corner-coordinate matches, each
 * `100 × (1 − |Δ| / extent)` over the larger capture width (x) or height (y), in percent.
 */
export function positionMatch(a: { core: PixelRect; captureSize: Size }, b: { core: PixelRect; captureSize: Size }): number {
  const width = Math.max(a.captureSize.width, b.captureSize.width);
  const height = Math.max(a.captureSize.height, b.captureSize.height);
  return (coordinate(a.core.x, b.core.x, width)
    + coordinate(a.core.y, b.core.y, height)
    + coordinate(a.core.x + a.core.width, b.core.x + b.core.width, width)
    + coordinate(a.core.y + a.core.height, b.core.y + b.core.height, height)) / 4;
}

/**
 * Puts each member into the first cluster whose representative (its first member) has the same image hash
 * and a position match of at least 97 %, across cases; OCR text plays no part.
 */
export function clusterMembers(members: readonly Member[]): Cluster[] {
  const clusters: Cluster[] = [];
  const byHash = new Map<string, Cluster[]>();
  for (const member of members) {
    const sameHash = byHash.get(member.imageHash) ?? [];
    byHash.set(member.imageHash, sameHash);
    const cluster = sameHash.find((candidate) => positionMatch(candidate.members[0]!, member) >= minimumPositionMatch);
    if (cluster === undefined) {
      const created: Cluster = { imageHash: member.imageHash, members: [member] };
      clusters.push(created);
      sameHash.push(created);
    } else {
      cluster.members.push(member);
    }
  }
  return clusters;
}
