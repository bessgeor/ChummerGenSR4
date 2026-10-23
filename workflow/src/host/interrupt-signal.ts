/**
 * Ctrl+C, closing the console window (SIGHUP) and Ctrl+Break stop the running steps and their child processes
 * instead of leaving them running; the thread stays resumable.
 */
export function interruptSignal(log: (line: string) => void): AbortSignal {
  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGHUP", "SIGBREAK"] as const) {
    process.once(signal, () => {
      log(`${signal}: stopping the running steps...`);
      controller.abort();
    });
  }
  return controller.signal;
}
