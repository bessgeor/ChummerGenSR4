# Benchmark items

One JSON file per accepted fix of a discrepancy cluster, written by `npm run eval -- benchmark add` and checked by `npm run eval -- benchmark check`. An item holds the cluster, the commit before the fix, the fix commit with its patch and touched hunks, the mechanism class, and the change that caused the discrepancy when it is known (`kind: revert` when the fix mostly undoes it). `npm run eval -- hindsight` grades the earlier answers about the cluster against the fix.
