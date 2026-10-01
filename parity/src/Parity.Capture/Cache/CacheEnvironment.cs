using System.Security.Cryptography;
using System.Text;

namespace Parity.Capture.Cache;

/// <summary>
/// The machine and runner state that decides how a capture looks, as cache key lines: screens, system DPI,
/// OS, cultures and the hashes of the capture runner's own assemblies.
/// </summary>
internal sealed record CacheEnvironment(IReadOnlyList<string> Lines)
{
    /// <summary>The lowercase hexadecimal SHA-256 of the lines joined with newlines.</summary>
    public string Fingerprint() =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", Lines)))).ToLowerInvariant();
}
