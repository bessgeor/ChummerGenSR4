import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

const holder = `
const Database = require("better-sqlite3");
const held = process.argv.slice(1).map((path) => {
  const database = new Database(path, { timeout: 0 });
  database.exec("BEGIN EXCLUSIVE");
  return database;
});
console.log("locked");
setInterval(() => undefined, 1000);
`;

/** Starts a process that holds an exclusive lock on each of `locks`, and resolves once it does. `kill` ends it without a release. */
export async function holdLocks(...locks: string[]): Promise<{ kill(): Promise<void> }> {
  for (const lock of locks) mkdirSync(dirname(lock), { recursive: true });
  const child = spawn(process.execPath, ["-e", holder, ...locks], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"] });
  await new Promise<void>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => reject(new Error(`The lock holder exited with ${code} before it held the locks.`)));
    child.stdout.once("data", () => {
      child.removeAllListeners("exit");
      resolve();
    });
  });
  return {
    kill: () => new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill();
    }),
  };
}
