import { spawnSync } from "node:child_process";

/**
 * Stops every process whose executable lives under the folder. A capture run starts the apps it drives from its
 * run folder; when the runner that started them dies first (Ctrl+C reaches it too), killing the runner's process
 * tree no longer finds them, so they are found by where they run from.
 */
export function stopAppsUnder(folder: string): void {
  if (process.platform !== "win32") return;
  const result = spawnSync("powershell.exe", [
    "-NoProfile", "-NonInteractive", "-Command",
    "Get-Process | Where-Object { $_.Path -and $_.Path.StartsWith($env:STRAY_APPS_ROOT, [StringComparison]::OrdinalIgnoreCase) } | Stop-Process -Force",
  ], { env: { ...process.env, STRAY_APPS_ROOT: folder.endsWith("\\") ? folder : `${folder}\\` }, timeout: 30_000, stdio: "ignore" });
  if (result.error !== undefined) throw result.error;
}
