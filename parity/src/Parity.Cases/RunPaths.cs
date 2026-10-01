namespace Parity.Cases;

/// <summary>Naming rules shared by the parity tools for the files inside one run folder.</summary>
public static class RunPaths
{
    /// <summary>A case or capture name as one path segment: invalid file name characters become <c>_</c>.</summary>
    public static string SafeSegment(string value)
    {
        char[] invalid = Path.GetInvalidFileNameChars();
        string safe = new(value.Select(character => invalid.Contains(character) ? '_' : character).ToArray());
        return string.IsNullOrWhiteSpace(safe) ? "unnamed" : safe;
    }

    /// <summary>A path relative to the run folder <paramref name="root"/>, with forward slashes.</summary>
    public static string Relative(string root, string path) => Path.GetRelativePath(root, path).Replace('\\', '/');
}
