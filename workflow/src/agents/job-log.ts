import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { dirname } from "node:path";
import { SetupError } from "../host/setup-error.js";

/**
 * The raw stream of one job, written to a file. A log that cannot be created or written is a setup error that names
 * the file, not an unhandled stream error: `onFailure` stops the job, and `close` throws.
 */
export class JobLog {
  private readonly stream: WriteStream;
  private failure: Error | null = null;

  constructor(private readonly file: string, private readonly label: string, onFailure: () => void) {
    try {
      mkdirSync(dirname(file), { recursive: true });
    } catch (error) {
      throw new SetupError(`${label}: the folder of the job log ${file} cannot be created: ${(error as Error).message}`);
    }
    this.stream = createWriteStream(file);
    this.stream.on("error", (error) => {
      this.failure ??= error;
      onFailure();
    });
  }

  write(text: string): void {
    if (this.failure === null) this.stream.write(text);
  }

  /** Ends the log and waits until it is written; throws a setup error when it failed at any time. */
  async close(): Promise<void> {
    if (this.failure === null) {
      await new Promise<void>((resolve) => {
        this.stream.once("error", () => resolve());
        this.stream.end(() => resolve());
      });
    }
    if (this.failure !== null) throw new SetupError(`${this.label}: the job log ${this.file} cannot be written: ${this.failure.message}`);
  }
}