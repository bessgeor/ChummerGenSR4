using System.Security.Cryptography;

namespace Parity.Capture.Staging;

/// <summary>Lower-case hex SHA-256 of a file's bytes.</summary>
internal sealed class FileHasher
{
    public string Sha256(string path)
    {
        using FileStream stream = new(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        return Convert.ToHexStringLower(SHA256.HashData(stream));
    }
}
