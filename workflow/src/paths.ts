import { join } from "node:path";

/** Where the workflow keeps its state and the tools it runs, relative to the repository root. */
export type WorkflowPaths = {
  readonly repositoryRoot: string;
  readonly workflowFolder: string;
  readonly checkpoints: string;
  readonly store: string;
  readonly steps: string;
  /** Hand-over files of desktop commands, inside the repository so that every lane sees them at the same path. */
  readonly laneScratch: string;
  readonly canonicalApp: string;
  readonly candidateApp: string;
  readonly captureTools: string;
  readonly compareTools: string;
  /** Datasets, eval runs and comparisons. */
  readonly evalsFolder: string;
  /** Benchmark items, committed. */
  readonly benchmark: string;
  /** Where certificates are kept unless the profile names another folder. */
  readonly certificates: string;
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
    laneScratch: join(workflowFolder, "lane-scratch"),
    canonicalApp: join(repositoryRoot, "bin"),
    candidateApp: join(repositoryRoot, "out", "candidate", "bin"),
    captureTools: toolFolder("Parity.Capture"),
    compareTools: toolFolder("Parity.Compare"),
    evalsFolder: join(repositoryRoot, "out", "evals"),
    benchmark: join(repositoryRoot, "workflow", "evals", "benchmark"),
    certificates: join(repositoryRoot, "workflow", "evals", "certificates"),
    threadFolder: (threadId) => join(workflowFolder, "threads", threadId),
  };
}
