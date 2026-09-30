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

    public static RunLayout Create(string runsDirectory, DateTimeOffset now)
    {
        string runId = $"{now.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}-{Guid.NewGuid().ToString("N")[..8]}";
        return new RunLayout(runId, Path.Combine(Path.GetFullPath(runsDirectory), runId));
    }

    public string CapturePath(string caseName, string side, string captureName) =>
        Path.Combine(Root, "captures", SafeSegment(caseName), side, $"{SafeSegment(captureName)}.png");

    /// <summary>A path relative to the run folder, with forward slashes.</summary>
    public string Relative(string path) => Path.GetRelativePath(Root, path).Replace('\\', '/');

    private static string SafeSegment(string value)
    {
        char[] invalid = Path.GetInvalidFileNameChars();
        string safe = new(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(safe) ? "unnamed" : safe;
    }
}
