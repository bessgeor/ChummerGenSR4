using System.Security.Cryptography;
using System.Text;

namespace Parity.Capture.Cache;

/// <summary>A cache key: the lower-case hex SHA-256 of its lines joined with <c>\n</c>, kept with the lines it was made of.</summary>
internal sealed record CacheKey(string Value, IReadOnlyList<string> Lines)
{
    public static CacheKey Of(IReadOnlyList<string> lines) =>
        new(Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", lines)))), lines);
}
