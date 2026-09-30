using System.Globalization;
using Parity.Capture.Staging;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureSummary;
using ResultRow = Parity.Contracts.CaptureResults.CaptureResult;

namespace Parity.Capture.Run;

/// <summary>
/// One capture run: validate inputs, verify the canonical executable, stage the run folder, run every
/// selected case on both sides, verify the canonical executable again, and write the summary and results.
/// </summary>
internal sealed class CaptureRun(
    CaptureOptionsParser parser,
    CaseFileLoader loader,
    CanonicalExecutableGuard guard,
    FileHasher hasher,
    RunStager stager,
    CaseRunner caseRunner,
    ReportWriter writer,
    ScreenInventory screens,
    TimeProvider time)
{
    public int Execute(IReadOnlyList<string> args)
    {
        CaptureOptions options;
        try
        {
            options = parser.Parse(args);
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine($"ERROR: {error.Message}");
            Console.Error.WriteLine(CaptureOptionsParser.Usage);
            return ExitCode(RunStatus.SetupError);
        }

        if (options.Help)
        {
            Console.WriteLine(CaptureOptionsParser.Usage);
            return 0;
        }

        DateTimeOffset started = time.GetUtcNow();
        string canonicalSource = options.Resolve(options.CanonicalExecutable);
        IReadOnlyList<ParityCase> cases;
        IReadOnlySet<string>? captureFilter;
        CaseSuite suite;
        string sourceHashBefore;
        try
        {
            suite = loader.Load(options.Resolve(options.CaseFile));
            cases = SelectCases(suite, options.Cases);
            captureFilter = SelectCaptures(cases, options.Captures);
            sourceHashBefore = guard.Verify(canonicalSource, "canonical executable");
        }
        catch (Exception error) when (error is CaseFileException or SetupException or ArgumentException)
        {
            Console.Error.WriteLine($"ERROR: {error.Message}");
            return ExitCode(RunStatus.SetupError);
        }

        RunLayout layout = RunLayout.Create(options.Resolve(options.RunsDirectory), started);
        Directory.CreateDirectory(layout.Root);
        Console.WriteLine($"Run {layout.RunId}: {layout.Root}");
        Console.WriteLine($"Canonical SHA-256 before: {sourceHashBefore}");
        RunReport report = new()
        {
            Layout = layout,
            Started = started,
            Status = RunStatus.SetupError,
            CaseFile = suite.CaseFilePath,
            Threshold = options.Threshold,
            CanonicalSource = canonicalSource,
            CanonicalSourceSha256Before = sourceHashBefore,
            CandidateSource = options.Resolve(options.CandidateExecutable),
            SettingsOverlay = options.SettingsOverlay is null ? null : Path.GetFullPath(options.SettingsOverlay, options.RepositoryRoot),
            Screens = screens.Current(),
            Cases = [],
        };
        List<CaseRun> runs = [];
        try
        {
            StagedRun staged = stager.Stage(layout, options.RepositoryRoot, canonicalSource, report.CandidateSource, report.SettingsOverlay, cases);
            report = report with { Staged = staged };
            UiTiming timing = new(TimeSpan.FromSeconds(suite.StartupDelaySeconds), TimeSpan.FromMilliseconds(suite.SettleMilliseconds));
            foreach (ParityCase parityCase in cases)
            {
                Console.WriteLine($"Case {parityCase.Name} ({parityCase.Actions.Count} actions)");
                runs.Add(caseRunner.Run(parityCase, layout, staged, timing, captureFilter, options.Threshold));
            }

            report = report with { Cases = runs };
            string sourceAfter = hasher.Sha256(canonicalSource);
            string stagedAfter = hasher.Sha256(staged.CanonicalExecutable);
            report = report with { CanonicalSourceSha256After = sourceAfter, CanonicalStagedSha256After = stagedAfter };
            Console.WriteLine($"Canonical SHA-256 after: {sourceAfter} (staged copy {stagedAfter})");
            if (sourceAfter != CanonicalExecutableGuard.PinnedSha256 || stagedAfter != CanonicalExecutableGuard.PinnedSha256)
            {
                throw new SetupException("The canonical executable changed during the run.");
            }

            report = report with { Finished = time.GetUtcNow(), Status = Status(runs) };
            writer.Write(layout.ResultsPath, writer.BuildResults(report));
            writer.Write(layout.SummaryPath, writer.BuildSummary(report, path => DisplayPath(options.RepositoryRoot, path)));
            PrintOutcome(runs, report.Status, layout);
            return ExitCode(report.Status);
        }
        catch (Exception error)
        {
            // Every other failure here is a setup error: it is recorded in the summary and fails the run.
            report = report with { Cases = runs, Status = RunStatus.SetupError, SetupError = $"{error.GetType().Name}: {error.Message}" };
            writer.Write(layout.SummaryPath, writer.BuildSummary(report, path => DisplayPath(options.RepositoryRoot, path)));
            Console.Error.WriteLine($"ERROR: {error}");
            Console.Error.WriteLine($"Summary: {layout.SummaryPath}");
            return ExitCode(RunStatus.SetupError);
        }
    }

    public static int ExitCode(RunStatus status) => status switch
    {
        RunStatus.Passed => 0,
        RunStatus.VisualDifferences => 1,
        RunStatus.ExecutionFailures => 2,
        _ => 3,
    };

    public static RunStatus Status(IReadOnlyList<CaseRun> runs)
    {
        if (runs.Any(run => run.Canonical.Failed || run.Candidate.Failed))
        {
            return RunStatus.ExecutionFailures;
        }

        return runs.SelectMany(run => run.Results).Any(row => !row.Passed) ? RunStatus.VisualDifferences : RunStatus.Passed;
    }

    private static IReadOnlyList<ParityCase> SelectCases(CaseSuite suite, IReadOnlyList<string> filter)
    {
        if (filter.Count == 0)
        {
            return suite.Cases;
        }

        List<ParityCase> selected = suite.Cases.Where(item => filter.Any(name =>
            string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase)
            || string.Equals(item.CharacterFile, name, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Path.GetFileNameWithoutExtension(item.CharacterFile), name, StringComparison.OrdinalIgnoreCase))).ToList();
        string[] unmatched = filter.Where(name => !selected.Any(item =>
            string.Equals(item.Name, name, StringComparison.OrdinalIgnoreCase)
            || string.Equals(item.CharacterFile, name, StringComparison.OrdinalIgnoreCase)
            || string.Equals(Path.GetFileNameWithoutExtension(item.CharacterFile), name, StringComparison.OrdinalIgnoreCase))).ToArray();
        return unmatched.Length == 0
            ? selected
            : throw new ArgumentException($"--case matches no case: {string.Join(", ", unmatched)}.");
    }

    private static IReadOnlySet<string>? SelectCaptures(IReadOnlyList<ParityCase> cases, IReadOnlyList<string> filter)
    {
        if (filter.Count == 0)
        {
            return null;
        }

        HashSet<string> known = cases.SelectMany(item => item.Actions.OfType<CaptureAction>()).Select(action => action.CaptureName).ToHashSet(StringComparer.Ordinal);
        string[] unknown = filter.Where(name => !known.Contains(name)).ToArray();
        return unknown.Length == 0
            ? filter.ToHashSet(StringComparer.Ordinal)
            : throw new ArgumentException($"--capture matches no capture of the selected cases: {string.Join(", ", unknown)}.");
    }

    private static void PrintOutcome(IReadOnlyList<CaseRun> runs, RunStatus status, RunLayout layout)
    {
        Console.WriteLine("Execution:");
        foreach (CaseRun run in runs)
        {
            foreach (Execution.SideRun side in new[] { run.Canonical, run.Candidate })
            {
                Console.WriteLine($"  {(side.Failed ? "FAILED" : "ok"),-6} {run.Case.Name}/{side.Side}: " +
                                  string.Join(", ", side.Actions.GroupBy(action => action.Outcome).Select(group => $"{group.Key}={group.Count()}")) +
                                  (side.Failed ? $" | {side.Failure}" : string.Empty));
            }
        }

        Console.WriteLine("Visual:");
        foreach (ResultRow row in runs.SelectMany(run => run.Results).OrderBy(row => row.Passed).ThenByDescending(row => row.Difference))
        {
            Console.WriteLine($"  {(row.Passed ? "PASS" : "FAIL"),-4} {row.Case}/{row.Capture}: " +
                              $"{row.Difference.ToString("0.######", CultureInfo.InvariantCulture)} ({Reason(row)})");
        }

        Console.WriteLine($"Status: {status} (exit {ExitCode(status)})");
        Console.WriteLine($"Summary: {layout.SummaryPath}");
        Console.WriteLine($"Results: {layout.ResultsPath}");
    }

    private static string Reason(ResultRow row) => row.Reason switch
    {
        Parity.Contracts.CaptureResults.ResultReason.WithinThreshold => "within-threshold",
        Parity.Contracts.CaptureResults.ResultReason.VisualDifference => "visual-difference",
        Parity.Contracts.CaptureResults.ResultReason.MissingCanonical => "missing-canonical",
        Parity.Contracts.CaptureResults.ResultReason.MissingCandidate => "missing-candidate",
        _ => row.Reason.ToString(),
    };

    private static string DisplayPath(string repositoryRoot, string path)
    {
        string relative = Path.GetRelativePath(repositoryRoot, path);
        return Path.IsPathRooted(relative) || relative.StartsWith("..", StringComparison.Ordinal)
            ? path
            : relative.Replace('\\', '/');
    }
}
