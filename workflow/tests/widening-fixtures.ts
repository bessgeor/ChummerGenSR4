import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import type { PatchFile } from "../src/repair/patch.js";

export function sha256Of(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** A repair archive folder with the after side of each edit under `files/after/`, and the patch's files. */
export function archiveWithPatch(folder: string, edits: Readonly<Record<string, { readonly before: string | null; readonly after: string }>>): { archive: string; files: PatchFile[] } {
  const files = Object.entries(edits).map(([path, edit]): PatchFile => {
    mkdirSync(dirname(join(folder, "files", "after", path)), { recursive: true });
    writeFileSync(join(folder, "files", "after", path), edit.after);
    if (edit.before !== null) {
      mkdirSync(dirname(join(folder, "files", "before", path)), { recursive: true });
      writeFileSync(join(folder, "files", "before", path), edit.before);
    }
    return {
      path, change: edit.before === null ? "added" : "modified", before: edit.before === null ? null : sha256Of(edit.before), after: sha256Of(edit.after),
      added: 1, removed: edit.before === null ? 0 : 1, binary: false,
    };
  });
  return { archive: folder, files };
}

function chunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  const typed = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const [toLeft, toUp, toUpLeft] = [Math.abs(estimate - left), Math.abs(estimate - up), Math.abs(estimate - upLeft)];
  if (toLeft <= toUp && toLeft <= toUpLeft) return left;
  return toUp <= toUpLeft ? up : upLeft;
}

/**
 * A PNG of 8-bit samples (`channels` per pixel: 1 grey, 2 grey-alpha, 3 RGB, 4 RGBA), each row filtered with the
 * filter of its index modulo 5, so every filter type is used.
 */
export function encodePng(width: number, height: number, channels: 1 | 2 | 3 | 4, samples: readonly number[], options: { depth?: number; interlace?: number } = {}): Buffer {
  const colour = { 1: 0, 2: 4, 3: 2, 4: 6 }[channels];
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = options.depth ?? 8;
  header[9] = colour;
  header[12] = options.interlace ?? 0;
  const stride = width * channels;
  const rows: number[] = [];
  for (let row = 0; row < height; row++) {
    const filter = row % 5;
    rows.push(filter);
    for (let index = 0; index < stride; index++) {
      const at = row * stride + index;
      const left = index >= channels ? samples[at - channels]! : 0;
      const up = row > 0 ? samples[at - stride]! : 0;
      const upLeft = row > 0 && index >= channels ? samples[at - stride - channels]! : 0;
      const predicted = [0, left, up, (left + up) >> 1, paeth(left, up, upLeft)][filter]!;
      rows.push((samples[at]! - predicted) & 0xff);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header), chunk("sRGB", Buffer.from([0])), chunk("IDAT", deflateSync(Buffer.from(rows))), chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** An RGBA image of `width` x `height` filled with one colour, with the listed pixels in another. */
export function solidPng(width: number, height: number, changed: readonly number[] = []): Buffer {
  const samples: number[] = [];
  for (let pixel = 0; pixel < width * height; pixel++) samples.push(...(changed.includes(pixel) ? [200, 10, 10, 255] : [240, 240, 240, 255]));
  return encodePng(width, height, 4, samples);
}

export type RowSpec = {
  readonly case: string;
  readonly capture: string;
  readonly passed: boolean;
  /** Indexes of candidate pixels in a different colour; null for no candidate capture. Default: none. */
  readonly candidate?: readonly number[] | null;
  readonly mode?: "build" | "career";
};

/** A capture run folder with `results.json` and 10 x 10 candidate PNGs for the rows. */
export function writeRun(folder: string, rows: readonly RowSpec[], threshold = 0.05): string {
  mkdirSync(folder, { recursive: true });
  const results = rows.map((spec) => {
    const candidate = spec.candidate === undefined ? [] : spec.candidate;
    const path = `captures/${spec.case}/candidate/${spec.capture}.png`;
    if (candidate !== null) {
      mkdirSync(dirname(join(folder, path)), { recursive: true });
      writeFileSync(join(folder, path), solidPng(10, 10, candidate));
    }
    return {
      case: spec.case, characterFile: `${spec.case}.chum`, mode: spec.mode ?? "build", capture: spec.capture, passed: spec.passed,
      reason: spec.passed ? "within-threshold" : candidate === null ? "missing-candidate" : "visual-difference", difference: spec.passed ? 0 : 0.2,
      ...(candidate === null ? {} : { candidateCapture: path }),
    };
  });
  writeFileSync(join(folder, "results.json"), JSON.stringify({ runId: "run", threshold, results }));
  return folder;
}
