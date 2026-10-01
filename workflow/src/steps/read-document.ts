import { readFileSync } from "node:fs";
import { z } from "zod";
import { SetupError } from "../host/setup-error.js";

/** Reads a JSON document and validates it against its schema; a document that cannot be read is a setup error. */
export function readDocument<T>(path: string, schema: z.ZodType<T>): T {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new SetupError(`${path} cannot be read: ${(error as Error).message}`);
  }
  const parsed = schema.safeParse(document);
  if (!parsed.success) throw new SetupError(`${path} does not match its schema: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}