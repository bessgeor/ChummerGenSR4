# Rider's MCP server across several checkouts

JetBrains Rider ships an MCP server (the bundled `MCP Server` plugin) that exposes the IDE's refactorings, builds and code analysis as tools. This note records how it behaves when several checkouts of this repository, for example git worktrees, are open at once. It was measured with Rider 2026.2.1 (build RD-262.9437.287) on Windows 10 with .NET Framework 4.8.1, on scratch copies of `Chummer/` and `ChummerGenSR4.sln` kept outside every checkout. The numbers are one machine's, taken once; they show an order of magnitude, not a benchmark.

## Setup

- **Do not build the app through the IDE or `build_solution_start`.** The solution's Release configuration writes `bin/ChummerGenSR4.exe`, the canonical executable, and the Debug configuration writes `ChummerGenSR4_Debug.*` into the tracked `bin/` folder. Build with `npm run build:candidate` or `parity/scripts/build-candidate.mjs`, which write elsewhere and check the canonical SHA-256 before and after.
- Turn the server on in `Settings > Tools > MCP Server`. It is stored in `%APPDATA%\JetBrains\Rider<version>\options\mcpServer.xml` (`enableMcpServer`). With `enableBraveMode` the tools run without a confirmation per call; a client that calls tools without a person present needs it.
- The server starts listening only after a project is loaded. Rider asks to trust a solution it has not seen; that modal dialog blocks loading until it is answered. Trusted solutions are kept in `options\trustedSolutions.xml` (one entry per solution, `<solution folder>\.idea\.idea.<solution name>`) and in `options\trusted-paths.xml`. Opening a second solution while Rider runs asks "This Window / New Window"; "Don't ask again" removes that dialog.
- Loading a solution from a cold start until the server answers took about two minutes.

## Endpoint

- Streamable HTTP at `http://127.0.0.1:<port>/stream` (JSON-RPC over POST, session in the `mcp-session-id` header). `/sse` is the SSE variant; `/mcp` does not exist.
- The port is not fixed: the first Rider process got 64482 and a second one 64483. Find it from the listening ports of `rider64.exe`, or probe.
- Every tool takes a `rootFolder` argument, the project folder. With one project open it may be left out; with several open, leaving it out is an error that lists the open projects. Pass it always.

## Tools

The server lists 80 tools. By area:

- **Refactoring**, each with a `preview` option: `rename_refactoring`, `move_type_to_namespace`, `safe_delete`, `extract_method`, `extract_interface`, `extract_base_class`, `change_api_signature`, `reorganize_namespaces`. There is no tool that renames a file, moves a type into another file or project, or moves a type between assemblies; only the namespace changes.
- **Edit and read**: `apply_patch`, `create_new_file`, `read_file`, `reformat_file`, `open_file_in_editor`, `post_edit_quality_check`.
- **Search and navigation**: `search_symbol`, `search_text`, `search_regex`, `search_file`, `get_symbol_info`, `analyze_calls`, `list_directory_tree`, `get_all_open_file_paths`.
- **Build and analysis**: `build_solution_start`, `build_solution_state`, `get_file_problems`, `lint_files`, `get_project_problems`, `get_solution_projects`, `get_project_dependencies`, `findTests`.
- **Run and debug**: `execute_run_configuration`, `get_run_configurations`, `execute_terminal_command`, the `xdebug_*` family, `attach_to_process`, `ignore_exception`.
- **Version control**: `git_status`, `get_repositories`.
- **Profiling and game engines**: the `dotTrace*` tools, `unity_profiler_*`, and Unreal tools (`ue_*`, `search_assets`, …); they do not apply to this repository.
- Others: `execute_tool` (runs another tool by name) and the inspection scripting tools (`run_inspection_kts` and its helpers).

## One Rider process, several worktrees

Starting `rider64.exe <other.sln>` while Rider runs hands the solution to the running process, which opens it in a second window. That one process serves both projects on one endpoint, and `rootFolder` selects the project.

- `rename_refactoring` of one symbol (`MTRNG`) in two copies at the same moment: both applied in about 0.7 s each, each change only in its own copy.
- `move_type_to_namespace` of `Improvement` to another namespace (19 files, 1053 call sites) in two copies at the same moment: 1.97 s and 2.08 s, 2.17 s of wall time in total, so the two overlapped. One after the other, moving `ListItem` (46 files, 644 call sites) took 2.3 s, then 3.6 s.
- A refactored copy built with `parity/scripts/build-candidate.mjs --source <copy>` (exit 0).

## Separate Rider processes

A second process needs its own configuration and system directories, or it hands over to the first one. Point `RIDER_PROPERTIES` at an `idea.properties` file that sets `idea.config.path`, `idea.system.path`, `idea.plugins.path` and `idea.log.path`.

- Copying the running configuration directory copies its `.lock` file too, and the copy fails to start ("Start Failed"). Delete `.lock` in the copy. The license came along with the copy (about 600 MB); there was no prompt.
- The second process had its own MCP endpoint (64483) and its own built-in server (63343), and served only its own project: another process's `rootFolder` is answered with "doesn't correspond to any open project".
- `move_type_to_namespace` of `XmlManager` (49 files, 406 call sites) in one project of each process at the same moment: 0.68 s and 4.16 s, overlapping.

## Memory (working sets)

| Arrangement | Frontend | Backend(s) | Total |
|---|---|---|---|
| One process, one solution | ~2.4 GB | ~1.5 GB | ~3.9 GB |
| One process, two solutions | ~2.6 GB | ~1.5 GB + ~1.7 GB | ~5.9 GB |
| Second process, one solution | ~3.0 GB | ~1.8 GB | ~4.8 GB |

An additional checkout costs about 1.7 GB inside one process and about 4.8 GB as a separate process.

## Result

- Refactorings in two checkouts ran at the same time, both in one process (one endpoint, chosen per call by `rootFolder`) and in two processes (two endpoints).
- One process with a window per checkout is the cheaper arrangement (about 1.7 GB per additional checkout); separate processes cost about 4.8 GB each and are needed only for isolation.
- Always pass `rootFolder`, and answer the modal dialogs (trust, "This Window / New Window") before the first call.
