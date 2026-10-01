using Parity.Capture.Execution;

namespace Parity.Capture.Cache;

/// <summary>
/// A stored canonical side, written as <c>entry.json</c> beside its PNG files: the key it is stored under
/// and its lines, the run that stored it, its action records and duration, and each capture's file and hash.
/// Only the capture runner reads and writes it.
/// </summary>
internal sealed record CacheEntry(
    int Format,
    string Key,
    IReadOnlyList<string> KeyLines,
    string RunId,
    long DurationMilliseconds,
    IReadOnlyList<ActionRecord> Actions,
    IReadOnlyList<CachedCapture> Captures);

/// <summary>One capture of a <see cref="CacheEntry"/>: its name, its file in the entry folder and the file's SHA-256.</summary>
internal sealed record CachedCapture(string Name, string File, string Sha256);
