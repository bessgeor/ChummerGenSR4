using System.Security.Cryptography;
using System.Text;
using Parity.Capture.Staging;

namespace Parity.Capture.Cache;

/// <summary>SHA-256 over every file of a folder: its relative path with forward slashes and its SHA-256, in ordinal path order.</summary>
internal sealed class FolderFingerprinter(FileHasher hasher)
{
    public string Fingerprint(string directory)
    {
        IEnumerable<string> lines = Directory.EnumerateFiles(directory, "*", SearchOption.AllDirectories)
            .Select(file => (Relative: Path.GetRelativePath(directory, file).Replace('\\', '/'), File: file))
            .OrderBy(entry => entry.Relative, StringComparer.Ordinal)
            .Select(entry => $"{entry.Relative}:{hasher.Sha256(entry.File)}");
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(string.Join("\n", lines))));
    }
}
