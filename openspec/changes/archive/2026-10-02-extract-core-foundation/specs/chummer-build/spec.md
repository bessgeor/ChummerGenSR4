## MODIFIED Requirements

### Requirement: The Release output stays in bin
The project's output path SHALL be `..\bin\` in both configurations, without a target framework subfolder, so that a build with the default output path writes `bin/ChummerGenSR4.exe`. Builds for comparison SHALL therefore go through `parity/scripts/build-candidate.mjs`, which SHALL pass `-restore` to MSBuild, set the output and intermediate folders to the ones it was given, and verify the canonical SHA-256 before and after. The app's class library `Core/Core.csproj` SHALL be restored and built with the app from the same source folder, into the same output folder, and SHALL keep its intermediate files in `Core\` below the intermediate folder given on the command line, so that the two projects never share one. A failed restore or compile SHALL exit with 1.

#### Scenario: Release output path
- **WHEN** the Release configuration of the project is evaluated without overrides
- **THEN** its target path is `bin\ChummerGenSR4.exe` at the repository root

#### Scenario: Candidate from a source copy
- **WHEN** `build-candidate.mjs --source <copy> --output <folder>` builds a copy of the repository's `Chummer/` and `Core/` outside the repository
- **THEN** restore and build leave the source copy and the repository untouched (restored packages come from the NuGet cache or a feed), the executable is `<folder>/bin/ChummerGenSR4.exe` with `ChummerGenSR4.Core.dll` beside it, the library's intermediate files are under `<folder>/obj/Core/`, and the canonical SHA-256 is the same before and after

#### Scenario: Source copy without the library
- **WHEN** the source copy holds `Chummer/` but no `Core/`
- **THEN** the build fails and the script exits with 1
