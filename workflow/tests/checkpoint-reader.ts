import { setImmediate } from "node:timers/promises";
import { openCheckpointSaver } from "../src/graph/checkpoint-database.js";

// A reader in a process of its own, as a dashboard would be: it opens the checkpoint database through a second
// saver and reads the thread's latest checkpoint and its history until it sees the final count. Each line it
// prints is JSON: `ready`, every count it sees for the first time, then `done` with its totals, or `error`.
const [path, threadId, finalText] = process.argv.slice(2) as [string, string, string];
const final = Number(finalText);
const config = { configurable: { thread_id: threadId, checkpoint_ns: "" } };
const print = (line: object) => process.stdout.write(`${JSON.stringify(line)}\n`);

try {
  const saver = openCheckpointSaver(path);
  print({ ready: true });
  const seen: number[] = [];
  let reads = 0;
  let history = 0;
  for (;;) {
    const tuple = await saver.getTuple(config);
    let listed = 0;
    for await (const _ of saver.list(config)) listed += 1;
    reads += 1;
    if (listed < history) throw new Error(`The thread's history shrank from ${history} to ${listed} checkpoints.`);
    history = listed;
    const count = (tuple?.checkpoint.channel_values as { count?: unknown } | undefined)?.count;
    if (typeof count === "number" && !seen.includes(count)) {
      if (seen.length > 0 && count < seen[seen.length - 1]!) throw new Error(`The count went back from ${seen[seen.length - 1]} to ${count}.`);
      seen.push(count);
      print({ seen: count });
    }
    if (count === final) break;
    await setImmediate();
  }
  saver.db.close();
  print({ done: true, reads, distinct: seen.length, history });
} catch (error) {
  print({ error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) });
  process.exitCode = 1;
}
