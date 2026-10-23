namespace Parity.Capture.Staging;

/// <summary>One overlay file as applied to a staged app: relative path, hash, and whether it replaced a canonical copy.</summary>
internal sealed record OverlayFileRecord(string RelativePath, string Sha256, bool Replaced);
