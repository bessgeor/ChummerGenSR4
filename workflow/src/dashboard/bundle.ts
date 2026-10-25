import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { SetupError } from "../host/setup-error.js";

/** The client's entry point. */
export const clientEntry = join(dirname(fileURLToPath(import.meta.url)), "client", "main.tsx");

/** Bundles the React client, with Mermaid, into one script; a failed build is a setup error with esbuild's messages. */
export async function bundleClient(entry = clientEntry): Promise<string> {
  try {
    const result = await build({
      entryPoints: [entry], bundle: true, write: false, format: "esm", platform: "browser", target: "es2022",
      minify: true, jsx: "automatic", define: { "process.env.NODE_ENV": "\"production\"" }, logLevel: "silent",
    });
    return result.outputFiles[0]!.text;
  } catch (error) {
    throw new SetupError(`The dashboard's page does not build: ${(error as Error).message}`);
  }
}
