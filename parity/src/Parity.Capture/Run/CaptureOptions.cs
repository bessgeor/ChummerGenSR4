namespace Parity.Capture.Run;

/// <summary>Command-line options; relative paths resolve against the repository root.</summary>
internal sealed record CaptureOptions
{
    public const double DefaultThreshold = 0.00004;

    public string RepositoryRoot { get; init; } = Directory.GetCurrentDirectory();

    public string CaseFile { get; init; } = Path.Combine("parity", "cases", "characters.json");

    public string CanonicalExecutable { get; init; } = Path.Combine("bin", "ChummerGenSR4.exe");

    public string CandidateExecutable { get; init; } = Path.Combine("out", "candidate", "bin", "ChummerGenSR4.exe");

    public string RunsDirectory { get; init; } = Path.Combine("out", "runs");

    /// <summary>A file that receives the run folder's full path once the folder exists, so a caller can find the run.</summary>
    public string? RunFolderFile { get; init; }

    /// <summary>A file that receives the SHA-256 of the environment the cache keys on; the run then ends without running a case.</summary>
    public string? EnvironmentFingerprintFile { get; init; }

    public string? SettingsOverlay { get; init; }

    /// <summary>Folder of the canonical capture cache; null runs every canonical side live and caches nothing.</summary>
    public string? CanonicalCache { get; init; }

    public double Threshold { get; init; } = DefaultThreshold;

    /// <summary>Case names or character file names (with or without extension); empty selects every case.</summary>
    public IReadOnlyList<string> Cases { get; init; } = [];

    /// <summary>Capture names to write; empty selects every capture. Every action still runs.</summary>
    public IReadOnlyList<string> Captures { get; init; } = [];

    /// <summary>Record the candidate side's UI tree after each capture.</summary>
    public bool UiTree { get; init; }

    public bool Help { get; init; }

    public string Resolve(string path) => Path.GetFullPath(Path.Combine(RepositoryRoot, path));
}
