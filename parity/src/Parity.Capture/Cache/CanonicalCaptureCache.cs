using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Parity.Capture.Execution;
using Parity.Capture.Staging;

namespace Parity.Capture.Cache;

/// <summary>
/// Stores completed canonical sides under their key and restores them into later runs. An entry is
/// written into a temporary folder and moved into place, and an existing entry is never replaced.
/// A restored capture must have its recorded hash; anything unreadable is a setup error, never a reason
/// to run the side live instead.
/// </summary>
internal sealed class CanonicalCaptureCache(FileHasher hasher)
{
    public const string EntryFileName = "entry.json";

    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        Converters = { new JsonStringEnumConverter(JsonNamingPolicy.KebabCaseLower) },
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    /// <summary>Restores the side stored under <paramref name="key"/> into the run, or returns null when there is no entry.</summary>
    public SideRun? TryRestore(CacheSession session, CacheKey key, Func<string, string> capturePath)
    {
        string folder = Path.Combine(session.Directory, key.Value);
        if (!Directory.Exists(folder))
        {
            return null;
        }

        CacheEntry entry = Read(folder, key);
        Dictionary<string, string> captures = new(StringComparer.Ordinal);
        foreach (CachedCapture capture in entry.Captures)
        {
            string source = Path.Combine(folder, capture.File);
            if (!File.Exists(source))
            {
                throw new SetupException($"The canonical cache entry {folder} has no file {capture.File} for capture '{capture.Name}'.");
            }

            string target = capturePath(capture.Name);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target);
            string hash = hasher.Sha256(target);
            if (hash != capture.Sha256)
            {
                throw new SetupException(
                    $"The canonical cache entry {folder} is corrupted: {capture.File} has SHA-256 {hash}, the entry records {capture.Sha256}.");
            }

            captures.Add(capture.Name, target);
        }

        return new SideRun(RunLayout.CanonicalSide, entry.Actions, captures, null, TimeSpan.FromMilliseconds(entry.DurationMilliseconds))
        {
            Origin = SideOrigin.Cached(key.Value, entry.RunId),
        };
    }

    /// <summary>Stores the sides the run queued and empties the queue; the run calls it once its canonical executable is verified.</summary>
    public void StorePending(CacheSession session)
    {
        foreach (PendingStore pending in session.Pending)
        {
            if (Store(session, pending.Key, pending.RunId, pending.Side))
            {
                session.Stored++;
                Console.WriteLine($"  {pending.Side.Side}: stored in the cache as {pending.Key.Value}");
            }
        }

        session.Pending.Clear();
    }

    /// <summary>Stores a completed side; returns false and leaves the existing entry when the key is already stored.</summary>
    public bool Store(CacheSession session, CacheKey key, string runId, SideRun side)
    {
        if (side.Failed)
        {
            throw new ArgumentException($"A failed side is never stored: {side.Failure}", nameof(side));
        }

        string folder = Path.Combine(session.Directory, key.Value);
        if (Directory.Exists(folder))
        {
            return false;
        }

        string incoming = Path.Combine(session.Directory, $".incoming-{Guid.NewGuid():N}");
        Directory.CreateDirectory(incoming);
        try
        {
            List<CachedCapture> captures = [];
            int number = 0;
            foreach ((string name, string path) in side.Captures.OrderBy(capture => capture.Key, StringComparer.Ordinal))
            {
                string file = $"capture-{++number}.png";
                File.Copy(path, Path.Combine(incoming, file));
                captures.Add(new CachedCapture(name, file, hasher.Sha256(Path.Combine(incoming, file))));
            }

            CacheEntry entry = new(CacheKeyBuilder.Format, key.Value, key.Lines, runId, (long)side.Duration.TotalMilliseconds, side.Actions, captures);
            File.WriteAllText(Path.Combine(incoming, EntryFileName), JsonSerializer.Serialize(entry, JsonOptions) + "\n", Utf8);
            if (Directory.Exists(folder))
            {
                return false;
            }

            try
            {
                Directory.Move(incoming, folder);
            }
            catch (IOException) when (Directory.Exists(folder))
            {
                // Another run stored the same key between the check and the move; its entry stays.
                return false;
            }

            return true;
        }
        finally
        {
            if (Directory.Exists(incoming))
            {
                Directory.Delete(incoming, recursive: true);
            }
        }
    }

    private static CacheEntry Read(string folder, CacheKey key)
    {
        string path = Path.Combine(folder, EntryFileName);
        CacheEntry? entry;
        try
        {
            entry = JsonSerializer.Deserialize<CacheEntry>(File.ReadAllText(path, Utf8), JsonOptions);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException or JsonException)
        {
            throw new SetupException($"The canonical cache entry {folder} cannot be read: {error.Message}");
        }

        if (entry is null || entry.Format != CacheKeyBuilder.Format || entry.Key != key.Value || !entry.KeyLines.SequenceEqual(key.Lines))
        {
            throw new SetupException($"The canonical cache entry {folder} does not belong to its key.");
        }

        return entry;
    }
}
