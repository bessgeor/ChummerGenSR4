import type { ChildProcess, spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough, Writable } from "node:stream";
import { finished } from "node:stream/promises";

/** What a fake child does once its input is closed: print lines, then exit; `hang` never exits until stopped. */
export type Script = { readonly lines: readonly string[]; readonly stderr?: string; readonly code: number | null; readonly hang?: boolean; readonly fail?: string };

export type SpawnCall = { command: string; args: string[]; cwd: string; env: Record<string, string>; input: string };

/** A child process that plays a script, and records how it was started. */
export class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly stdin: Writable;
  readonly pid = undefined;
  private closed = false;

  constructor(private readonly script: Script, private readonly call: SpawnCall) {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer, _encoding, callback) => {
        this.call.input += chunk.toString();
        callback();
      },
      final: (callback) => {
        callback();
        setImmediate(() => this.play());
      },
    });
  }

  private play(): void {
    if (this.script.fail !== undefined) {
      this.emit("error", new Error(this.script.fail));
      return;
    }
    for (const line of this.script.lines) this.stdout.write(`${line}\n`);
    if (this.script.stderr !== undefined) this.stderr.write(this.script.stderr);
    if (this.script.hang !== true) setImmediate(() => this.close(this.script.code));
  }

  close(code: number | null): void {
    if (this.closed) return;
    this.closed = true;
    // A real child closes after its output streams ended and were read.
    Promise.all([finished(this.stdout), finished(this.stderr)]).then(() => this.emit("close", code, null), () => this.emit("close", code, null));
    this.stdout.end();
    this.stderr.end();
  }
}

/** A spawn function that hands out fake children with the given scripts, in order, and records every call. */
export function fakeSpawn(scripts: Script[]): { spawn: typeof spawn; calls: SpawnCall[]; children: FakeChild[] } {
  const calls: SpawnCall[] = [];
  const children: FakeChild[] = [];
  const fake = ((command: string, args: readonly string[], options: { cwd: string; env: Record<string, string> }) => {
    const script = scripts.shift();
    if (script === undefined) throw new Error(`Unexpected spawn of ${command}.`);
    const call: SpawnCall = { command, args: [...args], cwd: options.cwd, env: options.env, input: "" };
    calls.push(call);
    const child = new FakeChild(script, call);
    children.push(child);
    return child as unknown as ChildProcess;
  }) as unknown as typeof spawn;
  return { spawn: fake, calls, children };
}

/** Stops a fake child as a kill would: it closes without an exit code. */
export function stopFake(child: ChildProcess): void {
  (child as unknown as FakeChild).close(null);
}
