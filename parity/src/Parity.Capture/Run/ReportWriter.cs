using System.Globalization;
using System.Text;
using Parity.Capture.Execution;
using Parity.Capture.Staging;
using Parity.Cases;
using Parity.Contracts.CaptureSummary;
using CaptureResultsContract = Parity.Contracts.CaptureResults.CaptureResults;
using CaptureSummaryContract = Parity.Contracts.CaptureSummary.CaptureSummary;
using CaptureTimingContract = Parity.Contracts.CaptureTiming.CaptureTiming;
using ExecutionCoverageContract = Parity.Contracts.ExecutionCoverage.ExecutionCoverage;
using CharacterMode = Parity.Cases.CharacterMode;
using ResultRow = Parity.Contracts.CaptureResults.CaptureResult;

namespace Parity.Capture.Run;

/// <summary>Maps a run to the summary and results contracts and writes them as UTF-8 JSON.</summary>
internal sealed class ReportWriter
{
    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    public CaptureSummaryContract BuildSummary(RunReport report, Func<string, string> displayPath)
    {
        List<ResultRow> rows = report.Cases.SelectMany(item => item.Results).ToList();
        List<SideRun> sides = report.Cases.SelectMany(item => new[] { item.Canonical, item.Candidate }).ToList();
        return new CaptureSummaryContract
        {
            RunId = report.Layout.RunId,
            StartedUtc = Timestamp(report.Started),
            FinishedUtc = report.Finished is { } finished ? Timestamp(finished) : null,
            Status = report.Status,
            SetupError = report.SetupError,
            CaseFile = displayPath(report.CaseFile),
            Threshold = report.Threshold,
            Canonical = new CanonicalExecutable
            {
                SourcePath = displayPath(report.CanonicalSource),
                StagedPath = report.Staged is null ? null : displayPath(report.Staged.CanonicalExecutable),
                PinnedSha256 = CanonicalExecutableGuard.PinnedSha256,
                SourceSha256Before = report.CanonicalSourceSha256Before,
                StagedSha256Before = report.Staged?.CanonicalSha256,
                SourceSha256After = report.CanonicalSourceSha256After,
                StagedSha256After = report.CanonicalStagedSha256After,
            },
            Candidate = new CandidateExecutable
            {
                SourcePath = displayPath(report.CandidateSource),
                StagedPath = report.Staged is null ? null : displayPath(report.Staged.CandidateExecutable),
                Sha256 = report.Staged?.CandidateSha256,
            },
            SettingsOverlay = report.Staged?.Overlay is { } overlay
                ? new SettingsOverlay
                {
                    Path = displayPath(report.SettingsOverlay!),
                    Files = overlay.Select(file => new OverlayFile { Path = file.RelativePath, Sha256 = file.Sha256, Replaced = file.Replaced }).ToList(),
                }
                : null,
            CanonicalCache = report.Cache is { } cache
                ? new CanonicalCache { Path = displayPath(cache.Directory), Hits = cache.Hits, Misses = cache.Misses, Stored = cache.Stored }
                : null,
            Screens = report.Screens.ToList(),
            Cases = report.Cases.Select(item => new CaseExecution
            {
                Case = item.Case.Name,
                CharacterFile = item.Case.CharacterFile,
                Mode = item.Case.Mode == CharacterMode.Career ? Mode.Career : Mode.Build,
                Sides = [Side(item.Canonical), Side(item.Candidate)],
            }).ToList(),
            Totals = new RunTotals
            {
                Cases = report.Cases.Count,
                FailedSides = sides.Count(side => side.Failed),
                FailedActions = sides.Sum(side => side.Actions.Count(action => action.Outcome == OutcomeKind.Failed)),
                Captures = rows.Count,
                VisualPassed = rows.Count(row => row.Passed),
                VisualFailed = rows.Count(row => !row.Passed),
            },
            Results = report.Finished is null ? null : report.Layout.Relative(report.Layout.ResultsPath),
            Coverage = report.Finished is null ? null : report.Layout.Relative(report.Layout.CoveragePath),
            Timing = report.Finished is null ? null : report.Layout.Relative(report.Layout.TimingPath),
            UiTrees = report.UiTrees && report.Finished is not null ? report.Layout.Relative(report.Layout.UiTrees) : null,
        };
    }

    public CaptureResultsContract BuildResults(RunReport report) => new()
    {
        RunId = report.Layout.RunId,
        Threshold = report.Threshold,
        Results = report.Cases.SelectMany(item => item.Results).ToList(),
    };

    public void Write(string path, CaptureSummaryContract summary) =>
        File.WriteAllText(path, ContractJson.Write(summary) + "\n", Utf8);

    public void Write(string path, CaptureResultsContract results) =>
        File.WriteAllText(path, ContractJson.Write(results) + "\n", Utf8);

    public void Write(string path, ExecutionCoverageContract coverage) =>
        File.WriteAllText(path, ContractJson.Write(coverage) + "\n", Utf8);

    public void Write(string path, CaptureTimingContract timing) =>
        File.WriteAllText(path, ContractJson.Write(timing) + "\n", Utf8);

    private static SideExecution Side(SideRun run) => new()
    {
        Side = run.Side == RunLayout.CanonicalSide ? Parity.Contracts.CaptureSummary.Side.Canonical : Parity.Contracts.CaptureSummary.Side.Candidate,
        Source = run.Origin.FromCache ? Source.Cache : Source.Live,
        CacheEntry = run.Origin.CacheKey,
        CachedFromRun = run.Origin.CachedFromRun,
        Status = run.Failed ? Status.Failed : Status.Completed,
        DurationMilliseconds = (long)run.Duration.TotalMilliseconds,
        Failure = run.Failure,
        Counts = new OutcomeCounts
        {
            Performed = Count(run, OutcomeKind.Performed),
            Failed = Count(run, OutcomeKind.Failed),
            OptionalAbsent = Count(run, OutcomeKind.OptionalAbsent),
            SkippedOptional = Count(run, OutcomeKind.SkippedOptional),
            Filtered = Count(run, OutcomeKind.Filtered),
            NotRun = Count(run, OutcomeKind.NotRun),
        },
        Actions = run.Actions.Select(action => new ActionExecution
        {
            Index = action.Index,
            Action = action.Action,
            Optional = !action.Required,
            Outcome = Outcome(action.Outcome),
            Reason = action.Reason,
        }).ToList(),
    };

    private static long Count(SideRun run, OutcomeKind outcome) => run.Actions.Count(action => action.Outcome == outcome);

    private static ActionOutcome Outcome(OutcomeKind outcome) => outcome switch
    {
        OutcomeKind.Performed => ActionOutcome.Performed,
        OutcomeKind.Failed => ActionOutcome.Failed,
        OutcomeKind.OptionalAbsent => ActionOutcome.OptionalAbsent,
        OutcomeKind.SkippedOptional => ActionOutcome.SkippedOptional,
        OutcomeKind.Filtered => ActionOutcome.Filtered,
        OutcomeKind.NotRun => ActionOutcome.NotRun,
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, null),
    };

    private static string Timestamp(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);
}
