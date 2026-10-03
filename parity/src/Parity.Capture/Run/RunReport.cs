using Parity.Capture.Cache;
using Parity.Capture.Staging;
using Parity.Contracts.CaptureSummary;

namespace Parity.Capture.Run;

/// <summary>Everything the summary and results files record about a run.</summary>
internal sealed record RunReport
{
    public required RunLayout Layout { get; init; }

    public required DateTimeOffset Started { get; init; }

    public DateTimeOffset? Finished { get; init; }

    public required RunStatus Status { get; init; }

    public string? SetupError { get; init; }

    public required string CaseFile { get; init; }

    public required double Threshold { get; init; }

    public required string CanonicalSource { get; init; }

    public required string CanonicalSourceSha256Before { get; init; }

    public string? CanonicalSourceSha256After { get; init; }

    public string? CanonicalStagedSha256After { get; init; }

    public required string CandidateSource { get; init; }

    public StagedRun? Staged { get; init; }

    public string? SettingsOverlay { get; init; }

    public CacheSession? Cache { get; init; }

    /// <summary>Whether the candidate side records a UI tree after each capture.</summary>
    public required bool UiTrees { get; init; }

    public required IReadOnlyList<ScreenInfo> Screens { get; init; }

    public required IReadOnlyList<CaseRun> Cases { get; init; }
}
