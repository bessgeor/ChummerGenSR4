import { join } from "node:path";

/** Where discovery keeps its checkpoints and its threads, under the repository's `out/`. */
export type DiscoveryPaths = {
  readonly root: string;
  readonly checkpoints: string;
  thread(threadId: string): ThreadFolders;
};

/** The files and folders of one discovery thread. */
export type ThreadFolders = {
  readonly root: string;
  readonly targets: string;
  readonly source: string;
  readonly rank: string;
  readonly logs: string;
  readonly cases: string;
  readonly inventory: string;
  readonly document: string;
  scenario(index: number): string;
};

export function discoveryPaths(repositoryRoot: string): DiscoveryPaths {
  const root = join(repositoryRoot, "out", "discovery");
  return {
    root,
    checkpoints: join(root, "checkpoints.sqlite"),
    thread: (threadId) => {
      const folder = join(root, "threads", threadId);
      return {
        root: folder, targets: join(folder, "targets.json"), source: join(folder, "source"), rank: join(folder, "rank"), logs: join(folder, "logs"),
        cases: join(folder, "cases.json"), inventory: join(folder, "inventory"), document: join(folder, "discovery.json"),
        scenario: (index) => join(folder, `scenario-${index}`),
      };
    },
  };
}
