namespace Parity.Capture.Execution;

/// <summary>
/// Where a side's record comes from: a live run, or a cache entry stored by <paramref name="CachedFromRun"/>.
/// <paramref name="CacheKey"/> is the key the side was looked up or stored under; null without a cache.
/// </summary>
internal sealed record SideOrigin(bool FromCache, string? CacheKey, string? CachedFromRun)
{
    public static SideOrigin Live { get; } = new(false, null, null);

    public static SideOrigin LiveWithKey(string cacheKey) => new(false, cacheKey, null);

    public static SideOrigin Cached(string cacheKey, string cachedFromRun) => new(true, cacheKey, cachedFromRun);
}
