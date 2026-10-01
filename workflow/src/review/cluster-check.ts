import { existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readDocument } from "../steps/read-document.js";

/** What the review page shows of a cluster's check: its observations, or why there are none. */
export type CheckView = { readonly value: unknown } | { readonly absent: string };

const DiagnosisChecksSchema = z.looseObject({
  clusters: z.array(z.looseObject({ clusterId: z.string(), check: z.unknown().nullable() })),
});

/** The cluster's check in the thread's `diagnosis.json`; an absent check says why. */
export function clusterCheck(threadFolder: string, clusterId: string): CheckView {
  const path = join(threadFolder, "diagnosis.json");
  if (!existsSync(path)) return { absent: `The thread has no diagnosis.json (${path}): its diagnosis did not finish, or its folder was removed.` };
  const cluster = readDocument(path, DiagnosisChecksSchema).clusters.find((item) => item.clusterId === clusterId);
  if (cluster === undefined) return { absent: "The thread's diagnosis.json has no entry for this cluster." };
  return cluster.check === null ? { absent: "The cluster was not checked: the check capture predicted nothing for it." } : { value: cluster.check };
}
