import { join } from "node:path";

/** Where the workflow keeps its state and the tools it runs, relative to the repository root. */
export type WorkflowPaths = {
  readonly repositoryRoot: string;
  readonly workflowFolder: string;
  readonly checkpoints: string;
  readonly store: string;
  readonly steps: string;
  readonly canonicalApp: string;
  readonly candidateApp: string;
  readonly captureTools: string;
  readonly compareTools: string;
  threadFolder(threadId: string): string;
};

export function workflowPaths(repositoryRoot: string): WorkflowPaths {
  const workflowFolder = join(repositoryRoot, "out", "workflow");
  const toolFolder = (project: string) => join(repositoryRoot, "parity", "src", project, "bin", "Release", "net10.0-windows");
  return {
    repositoryRoot,
    workflowFolder,
    checkpoints: join(workflowFolder, "checkpoints.sqlite"),
    store: join(workflowFolder, "store.sqlite"),
    steps: join(workflowFolder, "steps"),
    canonicalApp: join(repositoryRoot, "bin"),
    candidateApp: join(repositoryRoot, "out", "candidate", "bin"),
    captureTools: toolFolder("Parity.Capture"),
    compareTools: toolFolder("Parity.Compare"),
    threadFolder: (threadId) => join(workflowFolder, "threads", threadId),
  };
}
