namespace Parity.Capture.Staging;

/// <summary>Checks that a file is byte-identical to the canonical executable by its pinned SHA-256.</summary>
internal sealed class CanonicalExecutableGuard(FileHasher hasher)
{
    /// <summary>Also stated in <c>AGENTS.md</c> and <c>parity/scripts/build-candidate.mjs</c>; a test keeps the three equal.</summary>
    public const string PinnedSha256 = "9ff3009946f0212842eb5aa803c3d8e1697752040229f52b25f584e7b0ae9e56";

    /// <summary>Returns the file's hash, or throws <see cref="SetupException"/> when it is missing or differs.</summary>
    public string Verify(string path, string description)
    {
        if (!File.Exists(path))
        {
            throw new SetupException($"The {description} does not exist: {path}");
        }

        string actual = hasher.Sha256(path);
        if (!string.Equals(actual, PinnedSha256, StringComparison.Ordinal))
        {
            throw new SetupException($"The {description} has SHA-256 {actual}, expected the canonical {PinnedSha256}: {path}");
        }

        return actual;
    }
}
