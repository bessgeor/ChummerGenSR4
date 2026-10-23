using Parity.Cases;
using static Parity.Cases.RunPaths;

namespace Parity.Compare.Run;

/// <summary>The paths the comparer reads and writes inside one capture run folder.</summary>
internal sealed record RunFolder(string Root)
{
    public string ResultsPath => Path.Combine(Root, "results.json");

    public string CompareDirectory => Path.Combine(Root, "compare");

    public string ReportPath => Path.Combine(CompareDirectory, "report.json");

    public static RunFolder At(string path) => new(Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)));

    public string CropPath(string caseName, string captureName, int number, string side) =>
        Path.Combine(CompareDirectory, "crops", SafeSegment(caseName), $"{SafeSegment(captureName)}.{number}.{side}.png");

    /// <summary>A path from <c>results.json</c>, resolved against the run folder; it must stay inside it.</summary>
    public string Resolve(string relativePath)
    {
        string full = Path.GetFullPath(Path.Combine(Root, relativePath));
        // A drive root such as D:\ keeps its separator after trimming.
        string prefix = Path.EndsInDirectorySeparator(Root) ? Root : Root + Path.DirectorySeparatorChar;
        return full.StartsWith(prefix, StringComparison.OrdinalIgnoreCase) && full.Length > prefix.Length
            ? full
            : throw new CompareSetupException($"The capture path '{relativePath}' in {ResultsPath} leaves the run folder.");
    }

    /// <summary>A path relative to the run folder, with forward slashes.</summary>
    public string Relative(string path) => RunPaths.Relative(Root, path);
}
