import { SetupError } from "../host/setup-error.js";

/** The options of one evaluation command: `--name value` pairs and bare flags. */
export class CommandOptions {
  private constructor(private readonly command: string, private readonly values: Map<string, string>, private readonly flags: Set<string>) {}

  /** Parses `args`; an unknown option, a missing value and a repeated option are setup errors naming the command. */
  static parse(command: string, args: readonly string[], valued: readonly string[], flags: readonly string[] = []): CommandOptions {
    const values = new Map<string, string>();
    const set = new Set<string>();
    for (let index = 0; index < args.length; index++) {
      const option = args[index]!;
      const name = option.replace(/^--/, "");
      if (!option.startsWith("--") || (!valued.includes(name) && !flags.includes(name))) {
        throw new SetupError(`Unknown option '${option}' for '${command}'. See npm run eval -- --help.`);
      }
      if (values.has(name) || set.has(name)) throw new SetupError(`Option '${option}' is given twice.`);
      if (flags.includes(name)) {
        set.add(name);
        continue;
      }
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) throw new SetupError(`Option '${option}' needs a value.`);
      values.set(name, value);
      index++;
    }
    return new CommandOptions(command, values, set);
  }

  text(name: string): string | null {
    return this.values.get(name) ?? null;
  }

  required(name: string): string {
    const value = this.values.get(name);
    if (value === undefined) throw new SetupError(`'${this.command}' needs --${name}.`);
    return value;
  }

  flag(name: string): boolean {
    return this.flags.has(name);
  }

  /** A number option within bounds, or the fallback when it is not given. */
  number(name: string, fallback: number, minimum: number, maximum: number, integer = false): number {
    const text = this.values.get(name);
    if (text === undefined) return fallback;
    const value = Number(text);
    if (text.trim() === "" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isInteger(value))) {
      throw new SetupError(`--${name} must be ${integer ? "a whole number" : "a number"} from ${minimum} to ${maximum}, got '${text}'.`);
    }
    return value;
  }

  choice<T extends string>(name: string, choices: readonly T[], fallback: T): T {
    const text = this.values.get(name);
    if (text === undefined) return fallback;
    const match = choices.find((item) => item === text);
    if (match === undefined) throw new SetupError(`--${name} must be one of ${choices.join(", ")}, got '${text}'.`);
    return match;
  }
}
