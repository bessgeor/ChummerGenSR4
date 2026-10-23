using System.Globalization;
using Parity.Capture.Cache;
using Parity.Capture.Coverage;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureSummary;
using Parity.Contracts.ExecutionCoverage;
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
    CoverageAuditor auditor,
    TimingRecorder timingRecorder,
    CacheSessionFactory cacheSessions,
    CanonicalCaptureCache cache,
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
        string canonicalSource;
        IReadOnlyList<ParityCase> cases;
        IReadOnlySet<string>? captureFilter;
        CaseSuite suite;
        string sourceHashBefore;
        string? cacheDirectory = null;
        try
        {
            if (options.CanonicalCache is not null)
            {
                cacheDirectory = Path.GetFullPath(options.CanonicalCache, options.RepositoryRoot);
                UncommittableLocation.Ensure(options.RepositoryRoot, cacheDirectory, "canonical capture cache");
            }

            canonicalSource = options.Resolve(options.CanonicalExecutable);
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

        RunLayout layout;
        try
        {
            layout = RunLayout.Create(options.Resolve(options.RunsDirectory), started);
            Directory.CreateDirectory(layout.Root);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
        {
            // Without a run folder there is nowhere to write a summary.
            Console.Error.WriteLine($"ERROR: cannot create the run folder under {options.RunsDirectory}: {error.Message}");
            return ExitCode(RunStatus.SetupError);
        }

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
            Screens = [],
            Cases = [],
        };
        List<CaseRun> runs = [];
        try
        {
            if (options.RunFolderFile is not null)
            {
                File.WriteAllText(options.Resolve(options.RunFolderFile), layout.Root);
            }

            report = report with { Screens = screens.Current() };
            StagedRun staged = stager.Stage(layout, options.RepositoryRoot, canonicalSource, report.CandidateSource, report.SettingsOverlay, cases);
            report = report with { Staged = staged };
            if (cacheDirectory is not null)
            {
                report = report with { Cache = cacheSessions.Open(cacheDirectory, layout.CanonicalApp, report.Screens) };
                Console.WriteLine($"Canonical capture cache: {cacheDirectory}");
            }

            UiTiming timing = new(TimeSpan.FromSeconds(suite.StartupDelaySeconds), TimeSpan.FromMilliseconds(suite.SettleMilliseconds));
            foreach (ParityCase parityCase in cases)
            {
                Console.WriteLine($"Case {parityCase.Name} ({parityCase.Actions.Count} actions)");
                runs.Add(caseRunner.Run(parityCase, layout, staged, timing, captureFilter, options.Threshold, report.Cache));
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

            ExecutionCoverage coverage = auditor.Audit(layout.RunId, runs);
            report = report with { Finished = time.GetUtcNow(), Status = Status(runs, coverage) };
            writer.Write(layout.ResultsPath, writer.BuildResults(report));
            writer.Write(layout.CoveragePath, coverage);
            writer.Write(layout.TimingPath, timingRecorder.Build(layout.RunId));
            if (report.Cache is not null)
            {
                // Last, so that a run that fails while building its reports stores nothing; the summary records the count.
                cache.StorePending(report.Cache);
            }

            writer.Write(layout.SummaryPath, writer.BuildSummary(report, path => DisplayPath(options.RepositoryRoot, path)));
            PrintOutcome(runs, coverage, report.Cache, report.Status, layout);
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

    /// <summary>Execution failures, including coverage that is invalid for any reason, outrank visual results.</summary>
    public static RunStatus Status(IReadOnlyList<CaseRun> runs, ExecutionCoverage coverage)
    {
        if (!coverage.Valid || runs.Any(run => run.Canonical.Failed || run.Candidate.Failed))
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

    private static void PrintOutcome(IReadOnlyList<CaseRun> runs, ExecutionCoverage coverage, CacheSession? cache, RunStatus status, RunLayout layout)
    {
        Console.WriteLine("Execution:");
        foreach (CaseRun run in runs)
        {
            foreach (Execution.SideRun side in new[] { run.Canonical, run.Candidate })
            {
                Console.WriteLine($"  {(side.Failed ? "FAILED" : "ok"),-6} {run.Case.Name}/{side.Side}{(side.Origin.FromCache ? " (cache)" : string.Empty)}: " +
                                  string.Join(", ", side.Actions.GroupBy(action => action.Outcome).Select(group => $"{group.Key}={group.Count()}")) +
                                  (side.Failed ? $" | {side.Failure}" : string.Empty));
            }
        }

        CoverageTotals totals = coverage.Totals;
        Console.WriteLine($"Coverage: {(coverage.Valid ? "valid" : "INVALID")}; {totals.Sides} sides, {totals.Actions} actions, " +
                          $"{totals.Failures} failed, {totals.StartupFailures} startup failures, {totals.OptionalAbsent} optional absent, " +
                          $"{totals.SkippedOptional} skipped optional, {totals.Filtered} filtered, {totals.NotRun} not run; " +
                          $"{totals.CapturedPairs} of {totals.PlannedCaptures} planned captures on both sides");
        foreach (string reason in coverage.InvalidReasons)
        {
            Console.WriteLine($"  {reason}");
        }

        if (cache is not null)
        {
            Console.WriteLine($"Canonical capture cache: {cache.Hits} hits, {cache.Misses} misses, {cache.Stored} stored");
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
        Console.WriteLine($"Coverage: {layout.CoveragePath}");
        Console.WriteLine($"Timing: {layout.TimingPath}");
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
