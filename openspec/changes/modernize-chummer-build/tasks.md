# Tasks

## 1. Build

- [x] 1.1 Remove the Omae and Translation service clients, their service descriptions and `app.config` bindings, the Omae windows, menu item, options and `OmaeHelper`, moving `Decompress` into `frmUpdate`, on the old project. Evidence: `npm run build:candidate` builds it; the assembly metadata differs from a build of the previous source only by the removed types, resources, members and references.
- [x] 1.2 Convert `Chummer/Chummer.csproj` to an SDK-style net481 project with the reference assembly package, keeping the assembly name, startup object, icon, assembly info, AnyCPU flags and `..\bin\` output; set `app.config` to 4.8.1; pass `-restore` in `build-candidate.mjs`; describe the target in `openspec/config.yaml`. Evidence: the candidate builds from the repository and from a source copy outside it; the Release target path evaluates to `bin\ChummerGenSR4.exe`; the assembly metadata differs from the removal build only by the target framework; a stale `Chummer/obj/` source is not compiled.
- [x] 1.3 Keep the Windows Forms accessibility behaviour of the 4.0 target with the `Switch.UseLegacyAccessibilityFeatures` switches (levels 1 to 5) in `app.config`. Evidence: repeated full runs of the affected case show the focus rectangle without the switches and never with them; every case starts with the five switches set.
- [x] 1.4 Measure Rider's MCP server with two projects and write `docs/rider-mcp.md`. Evidence: the endpoint(s) and port(s) found, the tool list, the timings of concurrent refactorings in two projects (one process) and in two processes, the memory of each arrangement, and a refactored copy that builds through `build-candidate.mjs`, all recorded in `verification.md`.

## 2. Verification and archive

- [x] 2.1 Run `npm start` live over the whole case suite on the final source, with a deliberate kill and resume of the run, and the workflow's diagnosis, repair and widening applied to whatever it reports. Record in `verification.md` the canonical SHA-256 before and after, each case's execution outcome (capture status, coverage, where the canonical side came from) apart from its visual result and the compare report's completeness, each discrepancy cluster with the loop's outcome for it, the thread's outcome, the build and metadata checks of tasks 1.1 and 1.2 as fixture-tested scope apart from the live evidence, and what remains unverified.
- [ ] 2.2 Archive the change with `openspec archive modernize-chummer-build`. Evidence: `npm run openspec:validate` passes after the archive, recorded in `verification.md`.
