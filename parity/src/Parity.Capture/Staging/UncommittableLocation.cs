namespace Parity.Capture.Staging;

/// <summary>Run inputs and outputs that are never committed must live outside the repository or under its ignored <c>out/</c> folder.</summary>
internal static class UncommittableLocation
{
    public static void Ensure(string repositoryRoot, string directory, string what)
    {
        string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(repositoryRoot)) + Path.DirectorySeparatorChar;
        string candidate = Path.TrimEndingDirectorySeparator(Path.GetFullPath(directory)) + Path.DirectorySeparatorChar;
        string output = root + "out" + Path.DirectorySeparatorChar;
        if (candidate.StartsWith(root, StringComparison.OrdinalIgnoreCase) && !candidate.StartsWith(output, StringComparison.OrdinalIgnoreCase))
        {
            throw new SetupException($"The {what} must be outside the repository or under out/: {directory}");
        }
    }
}
