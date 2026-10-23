/**
 * A copy of the environment without the named variables (compared without case, as Windows does) and with the
 * given additions; variables without a value are left out.
 */
export function childEnvironment(environment: NodeJS.ProcessEnv, remove: readonly string[], add: Readonly<Record<string, string>> = {}): Record<string, string> {
  const removed = new Set(remove.map((name) => name.toUpperCase()));
  const copy: Record<string, string> = {};
  for (const [name, value] of Object.entries(environment)) {
    if (value !== undefined && !removed.has(name.toUpperCase())) copy[name] = value;
  }
  return { ...copy, ...add };
}
