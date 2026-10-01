import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";

export type ResolvedExecutable = { readonly path: string } | { readonly problem: string };

const shimExtensions = [".cmd", ".bat", ".ps1"];

/**
 * The file a CLI name starts. Without a shell, Windows starts only `.exe` and `.com` files from PATH, and a
 * `.cmd` shim (what `npm i -g` installs) fails with ENOENT; for a shim, `nativeBesideShim` names the native
 * program the shim's package holds (paths relative to the shim's folder), and when there is none the problem
 * says what to set instead. A name that is not found is returned as it is, so the start reports the missing file.
 */
export function resolveExecutable(
  executable: string, environment: NodeJS.ProcessEnv, nativeBesideShim: readonly string[] = [],
  platform: NodeJS.Platform = process.platform, exists: (path: string) => boolean = existsSync,
): ResolvedExecutable {
  if (platform !== "win32") return { path: executable };
  const shimProblem = (shim: string): ResolvedExecutable => ({
    problem: `${shim} is a script shim, which cannot be started without a shell; name the native program in the profile's agents.executables instead.`,
  });
  if (shimExtensions.some((extension) => executable.toLowerCase().endsWith(extension))) return shimProblem(executable);
  if (isAbsolute(executable) || /[\\/]/.test(executable)) return { path: executable };
  const pathVariable = Object.entries(environment).find(([name]) => name.toUpperCase() === "PATH")?.[1] ?? "";
  const folders = pathVariable.split(delimiter).filter((folder) => folder.length > 0);
  const named = /\.(?:exe|com)$/i.test(executable) ? [executable] : [`${executable}.exe`, `${executable}.com`];
  for (const folder of folders) {
    for (const name of named) if (exists(join(folder, name))) return { path: join(folder, name) };
  }
  for (const folder of folders) {
    for (const extension of shimExtensions) {
      const shim = join(folder, `${executable}${extension}`);
      if (!exists(shim)) continue;
      const native = nativeBesideShim.map((path) => join(dirname(shim), path)).find((path) => exists(path));
      return native === undefined ? shimProblem(shim) : { path: native };
    }
  }
  return { path: executable };
}

/** Where the `npm i -g` package of Claude Code keeps its native program, relative to the shim. */
export const claudeNativeBesideShim = [join("node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe")];
