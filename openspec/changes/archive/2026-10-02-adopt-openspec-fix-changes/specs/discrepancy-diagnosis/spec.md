## ADDED Requirements

### Requirement: Archived fixes are priors for the hypothesis
In a thread with fix changes, sealing a cluster's context SHALL read every archived fix change's `fix.json` under the repository's `fixes/openspec/changes/archive/`; a record that does not parse SHALL be a setup error naming it. Each SHALL be scored against the cluster: 8 for the same image hash, 3 for each capture name both have, 1 for each case both have, and 4 times the Jaccard similarity of the members' OCR words (runs of three or more letters or digits, lower case). Records scoring 0 SHALL be dropped and at most three SHALL be kept, by score and then by name. Each kept fix change SHALL be copied into the context's `priors/<name>/`, and the manifest SHALL list it with its score, the reasons for it, and its fix's claim, mechanism and changed files, so the context hash covers them. A context without priors SHALL be sealed as without fix changes.

When the context has priors, the hypothesis prompt SHALL present them as leads that must be verified in the snapshot and are never evidence, and SHALL carry the prompt version `hypothesis-v1+priors-v1`; the job's record SHALL carry that version. The challenge job SHALL NOT see the priors: its prompt, its copy of the manifest and its working folder hold none of them. Sealing a cluster's context again SHALL leave in `priors/` only the fix changes the manifest lists.

#### Scenario: A similar fix was archived
- **WHEN** an archived fix change shares the capture `common` and the case of a cluster, and the thread has fix changes
- **THEN** the cluster's context lists it as a prior with score 4 or more and the reasons `capture common` and `case <name>`, its folder is in `priors/`, and the hypothesis prompt names it

#### Scenario: Nothing similar
- **WHEN** no archived fix change shares an image hash, capture, case or OCR word with a cluster
- **THEN** the context has no priors and the hypothesis prompt and its version are those of a thread without fix changes

#### Scenario: The challenger does not see them
- **WHEN** a cluster's context has priors
- **THEN** the challenge prompt holds no prior's name, and the challenge job's working folder has no `priors/` folder and a `context.json` without `priors`
