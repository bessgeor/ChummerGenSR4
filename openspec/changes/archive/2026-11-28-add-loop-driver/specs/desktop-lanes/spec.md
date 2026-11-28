## ADDED Requirements

### Requirement: A paused lane takes no new desktop command
While a loop's control file marks a lane paused, the lane pool of that loop's threads SHALL NOT give the lane to a new desktop command; a command the lane is running SHALL run to its end. Desktop commands SHALL take the other free lanes, and SHALL wait, printing that every lane is paused, while every lane is paused or held. A lane SHALL take commands again as soon as the control file no longer marks it paused. Pausing SHALL NOT stop, cancel or fail a running command, and a waiting command SHALL NOT be reported as a failure. A pause holds back desktop commands only: the check of the lanes' identities and the reading of the lanes' capture environments, which runs on a lane's machine without its lock, SHALL include paused lanes, so that a lane unpaused later takes captures only after both, and a paused lane whose agent does not answer them is a setup error as an unpaused one is. An agent lane's paused flag SHALL be written beside its agent's heartbeat, as `paused.json` in its folder (`{ paused, updatedUtc }`), so that a reader of the folder sees it: `--pause` and `--unpause` write it, and after another writer changed the control file the loop writes it when one of its desktop commands next looks for a lane; every lane's flag and the task that holds it are in the loop's `state.json`.

#### Scenario: One of two lanes paused
- **WHEN** lane `vm` is paused while it captures case `a`, and cases `b` and `c` are still to be captured
- **THEN** `a` finishes on `vm`, and `b` and `c` are captured one after the other on lane `desktop`

#### Scenario: Every lane paused
- **WHEN** both lanes are paused and a case is to be captured
- **THEN** the case waits without failing, and is captured when either lane is resumed
