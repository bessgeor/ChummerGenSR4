# Proposal

## Why

The Chummer app is built from a legacy MSBuild project that lists all of its ~170 source files and ~80 resources by hand, targets the .NET Framework 4 Client Profile, and carries generated SOAP clients for the Omae and Translation web services. Those services no longer exist, and their clients pull `System.ServiceModel` into the app. An SDK-style project on net481 without the dead services gives the app a short project file that picks up new files on its own, a current target framework, and no code that only talks to servers that are gone.

## What Changes

- **BREAKING** Remove the Omae and Translation SOAP service clients (`Service References/`), their `services/*.asmx` descriptions and their `system.serviceModel` bindings in `app.config`, together with everything that only served them: the Omae forms (`frmOmae*`, `OmaeRecord`), the `Tools > Omae` menu item, the Omae account options in `GlobalOptions`, and `OmaeHelper`. The update window keeps decompressing downloaded data files with the gzip routine it used from `OmaeHelper`, now its own. The `System.ServiceModel`, `System.Runtime.Serialization` and `WindowsBase` references go with them.
- Convert `Chummer/Chummer.csproj` to an SDK-style project targeting `net481`. Source files, forms and their resources are included by convention; the one source file the old project did not compile (`InheritedListView.cs`) stays out. The assembly name, startup object, icon, `AssemblyInfo.cs`, AnyCPU without 32-bit preference, and the `..\bin\` output of both configurations stay as they were. The net481 reference assemblies come from the `Microsoft.NETFramework.ReferenceAssemblies` package, so building needs no Developer Pack. `app.config` asks for .NET Framework 4.8.1 and keeps the Windows Forms accessibility behaviour of the old target through the `Switch.UseLegacyAccessibilityFeatures` switches (levels 1 to 5), because the newer behaviour that the 4.8.1 target turns on changes how the app looks.
- `build-candidate.mjs` restores the project before it builds it (`msbuild -restore`), since the project now has a package reference.
- Add `docs/rider-mcp.md`: how JetBrains Rider's built-in MCP server serves several checkouts of this repository at once (endpoints, the refactoring tools it offers, concurrent refactorings, memory), measured on copies of `Chummer/`.

Area: the Chummer app (its project, configuration and the removed service code), its build tooling (`parity/scripts/build-candidate.mjs`) and a developer note on Rider's MCP server. Evidence: the candidate builds with the new project; its metadata differs from the build of the old project only by the removed service types and resources and the target framework; and a live `npm start` run of the whole case suite compares the candidate built from the new project with the canonical executable, with execution outcomes reported apart from visual results.

## Capabilities

### New Capabilities

- `chummer-build`: how the Chummer app is built: an SDK-style net481 project, what it compiles, where it puts its output, what the candidate build does with it, and that the app holds no clients for the removed web services.

### Modified Capabilities

None.

## Impact

- `Chummer/Chummer.csproj` (rewritten), `Chummer/app.config`, `Chummer/frmMain.cs`, `Chummer/frmMain.Designer.cs`, `Chummer/frmUpdate.cs`, `Chummer/clsOptions.cs`; deleted: `Chummer/Service References/`, `Chummer/services/`, `Chummer/clsOmaeHelper.cs`, `Chummer/frmOmae*`, `Chummer/OmaeRecord*`.
- `parity/scripts/build-candidate.mjs` (restore), which every candidate, diagnosis, repair and widening build goes through.
- `openspec/config.yaml` (project context: the app now targets net481).
- `ChummerGenSR4.sln` (header names Visual Studio 2019, the version the build uses; the solution is built with a package restore); `docs/rider-mcp.md` (new).
- The Omae menu item and windows disappear from the app; language files keep their Omae strings, which the print sheet lists still use.
- The canonical `bin/ChummerGenSR4.exe` is not touched.
