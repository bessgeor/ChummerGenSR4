import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { SetupError } from "../host/setup-error.js";

/** The repository's fixes root: the folder whose `openspec/` holds the `fix` schema and the archived fix changes. */
export function fixesRootOf(repositoryRoot: string): string {
  return join(repositoryRoot, "fixes");
}

/** Where the archived fix changes of a fixes root are. */
export function fixArchiveOf(fixesRoot: string): string {
  return join(fixesRoot, "openspec", "changes", "archive");
}

/** The archive's path inside the repository, with `/` separators: where a fix commit puts an archived fix change. */
export function fixArchiveInRepository(): string {
  const repositoryRoot = "repository";
  return relative(repositoryRoot, fixArchiveOf(fixesRootOf(repositoryRoot))).replaceAll("\\", "/");
}

export type FixArchiveRequest = {
  /** The repository's fixes root, whose config and schemas the staging root copies. */
  readonly fixesRoot: string;
  /** A folder that becomes the staging root; whatever is there is replaced. */
  readonly staging: string;
  readonly name: string;
  /** The change's files by name: the three artifacts and `fix.json`. */
  readonly files: Readonly<Record<string, string>>;
};

/** Creates, validates and archives a fix change in a staging root and returns the archived change's folder. */
export type FixChangeArchiver = (request: FixArchiveRequest) => string;

/** Runs the pinned OpenSpec CLI in a folder and returns its output; a non-zero exit is a setup error holding the output. */
export type OpenSpecCli = (args: readonly string[], cwd: string) => string;

export function processOpenSpecCli(repositoryRoot: string): OpenSpecCli {
  const script = join(repositoryRoot, "node_modules", "@fission-ai", "openspec", "bin", "openspec.js");
  return (args, cwd) => {
    if (!existsSync(script)) throw new SetupError(`The OpenSpec CLI is not installed at ${script}; run npm ci.`);
    try {
      return execFileSync(process.execPath, [script, ...args], {
        // Its progress lines go to standard error, which is kept for the failure message only.
        cwd, encoding: "utf8", windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, OPENSPEC_TELEMETRY: "0", OPENSPEC_NO_COMPLETIONS: "1", NO_COLOR: "1" },
      });
    } catch (error) {
      const failed = error as { status?: number; stdout?: string; stderr?: string; message: string };
      throw new SetupError(`openspec ${args.join(" ")} failed (exit ${failed.status ?? "unknown"}): ${`${failed.stdout ?? ""}${failed.stderr ?? ""}`.trim() || failed.message}`);
    }
  };
}

/** The task lines of a `tasks.md` that are not checked, and whether it has a checked one. */
function openTasks(tasks: string): { open: string[]; checked: number } {
  const lines = tasks.split(/\r?\n/);
  return { open: lines.filter((line) => /^\s*- \[ \]/.test(line)), checked: lines.filter((line) => /^\s*- \[[xX]\]/.test(line)).length };
}

/**
 * The archiver on the pinned CLI: a staging root with the repository's `fix` schema, `openspec new change`, the files,
 * a check that every task is done (the CLI's `archive -y` would archive open tasks), strict validation and the archive.
 */
export function openSpecArchiver(cli: OpenSpecCli): FixChangeArchiver {
  return (request) => {
    const source = join(request.fixesRoot, "openspec");
    for (const part of ["config.yaml", join("schemas", "fix", "schema.yaml")]) {
      if (!existsSync(join(source, part))) throw new SetupError(`The fixes root ${request.fixesRoot} has no openspec/${part.replaceAll("\\", "/")}.`);
    }
    const tasks = request.files["tasks.md"];
    if (tasks === undefined) throw new SetupError(`The fix change ${request.name} has no tasks.md.`);
    const { open, checked } = openTasks(tasks);
    if (open.length > 0 || checked === 0) {
      throw new SetupError(`The fix change ${request.name} is not done: ${open.length > 0 ? `open tasks ${open.map((line) => line.trim()).join("; ")}` : "it has no checked task"}.`);
    }
    rmSync(request.staging, { recursive: true, force: true });
    const root = join(request.staging, "openspec");
    mkdirSync(join(root, "changes", "archive"), { recursive: true });
    mkdirSync(join(root, "specs"), { recursive: true });
    cpSync(join(source, "config.yaml"), join(root, "config.yaml"));
    cpSync(join(source, "schemas"), join(root, "schemas"), { recursive: true });
    cli(["new", "change", request.name, "--schema", "fix"], request.staging);
    const folder = join(root, "changes", request.name);
    if (!existsSync(join(folder, ".openspec.yaml"))) throw new SetupError(`openspec new change did not create ${folder}.`);
    for (const [file, content] of Object.entries(request.files)) writeFileSync(join(folder, file), content);
    cli(["validate", request.name, "--strict", "--no-interactive"], request.staging);
    cli(["archive", request.name, "-y", "--skip-specs"], request.staging);
    const archived = readdirSync(join(root, "changes", "archive")).filter((entry) => entry.endsWith(`-${request.name}`));
    if (archived.length !== 1 || existsSync(folder)) {
      throw new SetupError(`openspec archive did not move ${request.name} into the archive (found ${archived.length === 0 ? "nothing" : archived.join(", ")}).`);
    }
    const result = join(root, "changes", "archive", archived[0]!);
    for (const file of Object.keys(request.files)) {
      if (readFileSync(join(result, file), "utf8") !== request.files[file]) throw new SetupError(`The archived fix change ${archived[0]} does not hold the ${file} that was written.`);
    }
    return result;
  };
}
