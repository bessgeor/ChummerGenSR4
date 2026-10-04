using Parity.Cases;
using static Parity.Cases.RunPaths;

namespace Parity.Capture.Staging;

/// <summary>The folders and files of one run under <c>out/runs/&lt;runId&gt;/</c>.</summary>
internal sealed record RunLayout(string RunId, string Root)
{
    public const string CanonicalSide = "canonical";
    public const string CandidateSide = "candidate";

    public string CanonicalApp => Path.Combine(Root, "apps", CanonicalSide);

    public string CandidateApp => Path.Combine(Root, "apps", CandidateSide);

    public string Characters => Path.Combine(Root, "characters");

    public string SummaryPath => Path.Combine(Root, "summary.json");

    public string ResultsPath => Path.Combine(Root, "results.json");

    public string CoveragePath => Path.Combine(Root, "coverage.json");

    public string TimingPath => Path.Combine(Root, "timing.json");

    /// <summary>The candidate side's UI trees, recorded with <c>--ui-tree</c>.</summary>
    public string UiTrees => Path.Combine(Root, "ui-trees");

    public static RunLayout Create(string runsDirectory, DateTimeOffset now)
    {
        string runId = $"{now.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}-{Guid.NewGuid().ToString("N")[..8]}";
        return new RunLayout(runId, Path.Combine(Path.GetFullPath(runsDirectory), runId));
    }

    public string CharacterCopy(string caseName, string characterFile) =>
        Path.Combine(Characters, SafeSegment(caseName), characterFile);

    /// <summary>One side's own copy of a fixture, for a case that saves the character.</summary>
    public string CharacterCopy(string caseName, string side, string characterFile) =>
        Path.Combine(Characters, SafeSegment(caseName), side, characterFile);

    public string CapturePath(string caseName, string side, string captureName) =>
        Path.Combine(Root, "captures", SafeSegment(caseName), side, $"{SafeSegment(captureName)}.png");

    public string UiTreePath(string caseName, string captureName) =>
        Path.Combine(UiTrees, SafeSegment(caseName), $"{SafeSegment(captureName)}.json");

    /// <summary>A path relative to the run folder, with forward slashes.</summary>
    public string Relative(string path) => RunPaths.Relative(Root, path);
}
