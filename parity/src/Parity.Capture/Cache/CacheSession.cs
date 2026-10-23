namespace Parity.Capture.Cache;

/// <summary>
/// The canonical capture cache as one run uses it: its folder, the run-wide key inputs, and how many
/// canonical sides it served, missed and stored.
/// </summary>
internal sealed class CacheSession(string directory, string appFingerprint, CacheEnvironment environment)
{
    public string Directory { get; } = directory;

    /// <summary>Fingerprint of the staged canonical app folder after the overlay.</summary>
    public string AppFingerprint { get; } = appFingerprint;

    public CacheEnvironment Environment { get; } = environment;

    public int Hits { get; set; }

    public int Misses { get; set; }

    public int Stored { get; set; }

    /// <summary>Completed live sides waiting for the run's final check of the canonical executable before they are stored.</summary>
    public List<PendingStore> Pending { get; } = [];
}

internal sealed record PendingStore(CacheKey Key, string RunId, Execution.SideRun Side);
