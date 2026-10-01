namespace Parity.Capture.Cache;

/// <summary>
/// The machine and runner state that decides how a capture looks, as cache key lines: screens, system DPI,
/// OS, cultures and the hashes of the capture runner's own assemblies.
/// </summary>
internal sealed record CacheEnvironment(IReadOnlyList<string> Lines);
