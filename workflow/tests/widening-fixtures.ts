import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { crc32, deflateSync } from "node:zlib";
import type { AttemptBuild, AttemptBuildRequest } from "../src/repair/attempt-host.js";
import type { LevelCapture, LevelCaptureRequest } from "../src/widening/level-capture.js";

const examples = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "contracts", "examples");

/** What a fake level or baseline capture observes for a case and capture: a failing row with its candidate pixels, or nothing. */
export type Observed = { readonly passed: false; readonly candidate?: readonly number[] | null } | "missing";

export type WideningScript = {
  /** The build's exit status for a request, or "hang" to run until its signal stops it. Default 0. */
  readonly build?: (request: AttemptBuildRequest) => number | "hang";
  /** What a capture observes; anything not named passes. `baseline` tells a capture of the accepted build. */
  readonly observe?: (request: LevelCaptureRequest, caseName: string, capture: string, baseline: boolean) => Observed | undefined;
  /** The exit status of a capture, or "hang" to run until its signal stops it; by default 1 with a failing row, else 0. */
  readonly status?: (request: LevelCaptureRequest, baseline: boolean) => 0 | 1 | 2 | "hang" | undefined;
  /** Cases a run covers besides the requested ones, as the runner does when a case name matches another fixture's file name. */
  readonly alsoCovered?: (request: LevelCaptureRequest, baseline: boolean) => readonly string[];
};

/** A fake host for widening: builds write an executable naming their source, and captures answer from a script with real PNGs. */
export class FakeWideningHost {
  readonly builds: AttemptBuildRequest[] = [];
  /** What each build's `Chummer/frmCreate.cs` held when it started. */
  readonly builtSources: string[] = [];
  readonly captures: { readonly request: LevelCaptureRequest; readonly baseline: boolean; readonly runFolder: string }[] = [];

  constructor(private readonly root: string, private readonly captureNames: (caseName: string) => readonly string[], public script: WideningScript = {}) {}

  readonly build: AttemptBuild = async (request) => {
    this.builds.push(request);
    this.builtSources.push(readFileSync(join(request.source, "Chummer", "frmCreate.cs"), "utf8"));
    const status = this.script.build?.(request) ?? 0;
    if (status === "hang") return new Promise<number>((_resolve, reject) => request.signal.addEventListener("abort", () => reject(new Error(`${request.label}: stopped`)), { once: true }));
    mkdirSync(join(request.output, "bin"), { recursive: true });
    writeFileSync(join(request.output, "bin", "ChummerGenSR4.exe"), `built from ${request.source}`);
    writeFileSync(request.log, `build of ${request.source}\n`);
    return status;
  };

  readonly capture: LevelCapture = async (request) => {
    // A baseline capture runs the accepted build, which is never the widened candidate of a cluster folder's build.
    const baseline = request.label.endsWith(" baseline");
    if (!existsSync(request.candidateExecutable)) throw new Error(`${request.label}: no executable ${request.candidateExecutable}`);
    const status = this.script.status?.(request, baseline);
    if (status === "hang") return new Promise((_resolve, reject) => request.signal?.addEventListener("abort", () => reject(new Error(`${request.label}: stopped`)), { once: true }));
    const runFolder = join(this.root, "level-runs", String(this.captures.length + 1));
    this.captures.push({ request, baseline, runFolder });
    const rows: RowSpec[] = request.cases.flatMap((caseName) => (request.captures ?? this.captureNames(caseName)).flatMap((capture): RowSpec[] => {
      const observed = this.script.observe?.(request, caseName, capture, baseline);
      if (observed === "missing") return [];
      return [observed === undefined ? { case: caseName, capture, passed: true } : { case: caseName, capture, passed: false, candidate: observed.candidate ?? [] }];
    }));
    writeRun(runFolder, rows, 0.05);
    const coverage = JSON.parse(readFileSync(join(examples, "parity-execution-coverage.example.json"), "utf8")) as { valid: boolean; invalidReasons: string[]; cases: { case: string }[] };
    const exit = status ?? (rows.some((row) => !row.passed) ? 1 : 0);
    coverage.valid = exit !== 2;
    coverage.invalidReasons = exit === 2 ? ["failure:build-alpha/candidate"] : [];
    coverage.cases = [...request.cases, ...(this.script.alsoCovered?.(request, baseline) ?? [])].map((name) => ({ ...coverage.cases[0]!, case: name }));
    writeFileSync(join(runFolder, "coverage.json"), JSON.stringify(coverage));
    return { status: exit, runFolder };
  };

  /** The labels of the captures, in order. */
  labels(): string[] {
    return this.captures.map((item) => item.request.label);
  }
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

/** Writes a `coverage.json` into a run folder: valid, or invalid like the example's own execution failure. */
export function writeCoverage(folder: string, valid: boolean): void {
  const coverage = JSON.parse(readFileSync(join(examples, "parity-execution-coverage.example.json"), "utf8")) as { valid: boolean; invalidReasons: string[] };
  coverage.valid = valid;
  coverage.invalidReasons = valid ? [] : ["failure:build-alpha/candidate"];
  writeFileSync(join(folder, "coverage.json"), JSON.stringify(coverage));
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
