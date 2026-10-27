import { existsSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { discoveryThreadId } from "./discovery/thread-discovery.js";
import type { BranchGit } from "./git/branch-git.js";

/** The places a workflow thread's ID leaves things behind, besides the workflow checkpoint database. */
export type ThreadTraceSources = {
  /** The folder of a workflow thread, `threads/<thread>`. */
  readonly threadFolder: (threadId: string) => string;
  /** The folder of a discovery thread. */
  readonly discoveryThreadFolder: (threadId: string) => string;
  readonly git: BranchGit;
};

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Whether a folder named like `path` is there, whatever the case of its name: the thread folders sit on file systems that ignore it. */
function folderExists(path: string): boolean {
  if (existsSync(path)) return true;
  const parent = dirname(path);
  if (!existsSync(parent)) return false;
  const name = path.slice(parent.length + 1);
  return readdirSync(parent).some((entry) => same(entry, name));
}

/**
 * What already uses a thread ID, whatever the case: the thread's folder, its discovery thread's folder and the branches
 * `accepted/<thread>` and `workflow/<thread>/…`. Empty when the ID is free.
 */
export function threadTraces(sources: ThreadTraceSources, threadId: string): string[] {
  const traces: string[] = [];
  if (folderExists(sources.threadFolder(threadId))) traces.push(`its folder ${sources.threadFolder(threadId)}`);
  const discovery = sources.discoveryThreadFolder(discoveryThreadId(threadId));
  if (folderExists(discovery)) traces.push(`its discovery thread's folder ${discovery}`);
  const refs = sources.git(["for-each-ref", "--format=%(refname:short)", "refs/heads/accepted", "refs/heads/workflow"]).split(/\r?\n/).filter((ref) => ref !== "");
  for (const ref of refs) {
    const [family, name] = ref.split("/");
    if ((family === "accepted" || family === "workflow") && name !== undefined && same(name, threadId)) traces.push(`the branch ${ref}`);
  }
  return traces;
}
