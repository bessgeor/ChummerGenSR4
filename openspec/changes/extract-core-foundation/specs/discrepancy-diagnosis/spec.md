## ADDED Requirements

### Requirement: Diagnosis prompts describe the compiled source
The hypothesis and challenge prompts SHALL describe the compiled folders that the snapshot holds (`Chummer/` and `Core/`; only `Chummer/` for a snapshot taken before the class library existed) as the app's C# source and `bin/data/` and `bin/lang/` as its data and translations, and SHALL carry the prompt versions `hypothesis-v2` and `challenge-v2`; every job's record SHALL carry the version of its prompt.

#### Scenario: Hypothesis prompt
- **WHEN** a hypothesis job of a thread without fix changes starts
- **THEN** its prompt starts with `PROMPT_VERSION=hypothesis-v2`, names `Chummer/` and `Core/` as the C# source, and its record carries `hypothesis-v2`

#### Scenario: Snapshot without the class library
- **WHEN** a hypothesis prompt is built for a snapshot that holds `Chummer/` but no `Core/`
- **THEN** it names `Chummer/` as the C# source and does not mention `Core/`

## MODIFIED Requirements

### Requirement: Each cluster is diagnosed from a sealed context
Before any model job, the workflow SHALL write for each cluster a context made only of recorded evidence: the cluster's members with their cores, crops and both sides' OCR text; for each member case its mode, fixture file name and fixture hash and the expanded actions up to the capture; the cases and captures a check may name; and the identity of a history-less snapshot of the app's source and data that the thread shares. The context SHALL be identified by the SHA-256 of its manifest, building it again from the same run SHALL give the same hash, and every job of the cluster SHALL record that hash. Prompts SHALL be built from the manifest only and SHALL mark text taken from the run as untrusted data. Each job SHALL work in a copy of its cluster's context folder and of the snapshot, made in a scratch folder outside the repository and removed when the job ends (a copy that cannot be removed is named in the log and does not replace the job's result), so that no log of another job, other thread, instruction file or version history of the repository lies around its working folder, whichever way a provider limits reads; the snapshot SHALL have no version history and SHALL be of the source the captured candidate was built from: a candidate build SHALL record next to the candidate the identity of the compiled source (`Chummer/` and `Core/`) as it was when the build started, and when the compiled source of the snapshot differs from that record, or the candidate has none, the run SHALL end with status 3 and no job SHALL run, also with `--only diagnose` on recorded captures. Data and language files are copied into each staged app at capture time, so they are capture inputs and not build inputs, and editing them SHALL NOT make diagnosis fail. A recorded file that the context needs and cannot read SHALL be a setup error.

#### Scenario: Same run, same context
- **WHEN** a thread is resumed and the context of a cluster is built again
- **THEN** its hash equals the hash recorded by the jobs before the interruption

#### Scenario: Source edited without a rebuild
- **WHEN** a file under `Chummer/` or `Core/` is edited after the candidate was built and `npm start -- --only diagnose` runs on the recorded captures
- **THEN** the run ends with status 3 naming the recorded and the current identity and saying to build again, and no job runs

#### Scenario: Data file edited without a rebuild
- **WHEN** a file under `bin/data` or `bin/lang` is edited and the candidate is not rebuilt
- **THEN** diagnosis runs

#### Scenario: Candidate without a recorded source
- **WHEN** the candidate was built outside the workflow and `--only diagnose` runs
- **THEN** the run ends with status 3 saying that the build step has to record the source, and no job runs

#### Scenario: Job folders
- **WHEN** a job runs
- **THEN** its working folder and the snapshot beside it are copies outside the repository and the thread's folder, the prompt names only those copies, and they are made only when the job gets its place in the model pool and removed after the job

#### Scenario: Missing crop
- **WHEN** a crop listed in `triage.json` no longer exists
- **THEN** the run ends with status 3 naming the file, and no job of that cluster runs

### Requirement: Archived fixes are priors for the hypothesis
In a thread with fix changes, sealing a cluster's context SHALL read every archived fix change's `fix.json` under the repository's `fixes/openspec/changes/archive/`; a record that does not parse SHALL be a setup error naming it. Each SHALL be scored against the cluster: 8 for the same image hash, 3 for each capture name both have, 1 for each case both have, and 4 times the Jaccard similarity of the members' OCR words (runs of three or more letters or digits, lower case). Records scoring 0 SHALL be dropped and at most three SHALL be kept, by score and then by name. Each kept fix change SHALL be copied into the context's `priors/<name>/`, and the manifest SHALL list it with its score, the reasons for it, and its fix's claim, mechanism and changed files, so the context hash covers them. A context without priors SHALL be sealed as without fix changes.

When the context has priors, the hypothesis prompt SHALL present them as leads that must be verified in the snapshot and are never evidence, and SHALL carry the prompt version `hypothesis-v2+priors-v1`; the job's record SHALL carry that version. The challenge job SHALL NOT see the priors: its prompt, its copy of the manifest and its working folder hold none of them. Sealing a cluster's context again SHALL leave in `priors/` only the fix changes the manifest lists.

#### Scenario: A similar fix was archived
- **WHEN** an archived fix change shares the capture `common` and the case of a cluster, and the thread has fix changes
- **THEN** the cluster's context lists it as a prior with score 4 or more and the reasons `capture common` and `case <name>`, its folder is in `priors/`, and the hypothesis prompt names it

#### Scenario: Nothing similar
- **WHEN** no archived fix change shares an image hash, capture, case or OCR word with a cluster
- **THEN** the context has no priors and the hypothesis prompt and its version are those of a thread without fix changes

#### Scenario: The challenger does not see them
- **WHEN** a cluster's context has priors
- **THEN** the challenge prompt holds no prior's name, and the challenge job's working folder has no `priors/` folder and a `context.json` without `priors`
