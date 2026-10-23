# chummer-build Specification

## Purpose
Defines how the Chummer app is built: an SDK-style net481 project, what it compiles and embeds, where its output goes, how builds for comparison are made, the runtime switches that keep its former look, and that it carries no clients for retired web services.

## Requirements

### Requirement: The app builds from an SDK-style net481 project
`Chummer/Chummer.csproj` SHALL be an SDK-style project (`Microsoft.NET.Sdk`) with `TargetFramework` `net481`, `OutputType` `WinExe`, `AssemblyName` `ChummerGenSR4` (`ChummerGenSR4_Debug` in Debug), `RootNamespace` `Chummer`, the startup object `Chummer.Program`, the icon `chummer.ico`, the assembly attributes of `Properties/AssemblyInfo.cs` (no generated assembly info), and AnyCPU without a 32-bit preference. It SHALL take the net481 reference assemblies from the `Microsoft.NETFramework.ReferenceAssemblies` package, so that building needs no .NET Framework Developer Pack, and SHALL build with the MSBuild of Visual Studio after a restore. `Chummer/app.config` SHALL name `.NETFramework,Version=v4.8.1` as its supported runtime and SHALL set `Switch.UseLegacyAccessibilityFeatures`, `.2`, `.3`, `.4` and `.5` to `true`, so that the app keeps the Windows Forms accessibility behaviour of its former 4.0 target.

#### Scenario: Start with the legacy accessibility switches
- **WHEN** the built app is started on .NET Framework 4.8.1
- **THEN** it shows its main window; a set of switches that leaves a higher accessibility level on while a lower one is off, which the framework rejects at startup, never ships

#### Scenario: Focus rectangles as in the canonical executable
- **WHEN** the full build scenario of a character selects the "Other Info" tab and captures the character window, on the candidate and on the canonical executable
- **THEN** neither capture shows a focus rectangle on the tab, in repeated runs

#### Scenario: Build without a Developer Pack
- **WHEN** the project is restored and built with Visual Studio's MSBuild on a machine without the .NET Framework 4.8.1 Developer Pack
- **THEN** the build succeeds and the executable's `TargetFrameworkAttribute` is `.NETFramework,Version=v4.8.1`

#### Scenario: Restore fails
- **WHEN** the reference assembly package can be found neither in the NuGet cache nor on a feed
- **THEN** MSBuild fails with the restore error and no executable is reported as built

### Requirement: The project compiles what the app is made of
The project SHALL compile every C# source file under `Chummer/` except `InheritedListView.cs` and anything under `Chummer/obj/` or `Chummer/bin/`, and SHALL embed every `.resx` file under `Chummer/` with the manifest resource name of the class it belongs to (`Chummer.<form>.resources`, `Chummer.Properties.Resources.resources`). It SHALL copy `settings/Darkness_in_the_heart_of_texas.xml` to the output on every build.

#### Scenario: A form added to the folder
- **WHEN** a new form with its `.cs`, `.Designer.cs` and `.resx` files is added under `Chummer/`
- **THEN** it is compiled and its resources are embedded as `Chummer.<form>.resources` without editing the project

#### Scenario: Intermediate files left by another build
- **WHEN** `Chummer/obj/` holds generated sources from an IDE build and the project is built with its intermediate folder elsewhere
- **THEN** none of the files under `Chummer/obj/` is compiled

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

### Requirement: The app holds no clients for the removed web services
The app SHALL NOT contain the Omae or Translation SOAP service clients, their service descriptions, their `system.serviceModel` bindings and endpoints in `app.config`, or code and options that only served them: the Omae windows, the `Tools > Omae` menu item and the Omae account options. It SHALL NOT reference `System.ServiceModel`. The update window SHALL still decompress the data files it downloads.

#### Scenario: Built executable
- **WHEN** the app is built from the project
- **THEN** its assembly references no `System.ServiceModel`, contains no type in the `Chummer.OmaeService` or `Chummer.TranslationService` namespace and no Omae form, and its `.config` file has no `system.serviceModel` section

#### Scenario: Tools menu
- **WHEN** the main window's Tools menu is opened
- **THEN** it lists the dice roller, the options and the update check, and no Omae item
