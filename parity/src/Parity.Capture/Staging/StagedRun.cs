namespace Parity.Capture.Staging;

/// <summary>What staging produced: the executables to launch, their hashes, the overlay and the fixture copies.</summary>
internal sealed record StagedRun(
    string CanonicalExecutable,
    string CanonicalSha256,
    string CandidateExecutable,
    string CandidateSha256,
    IReadOnlyList<OverlayFileRecord>? Overlay,
    IReadOnlyDictionary<string, string> CharacterCopies);
