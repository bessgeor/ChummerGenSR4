namespace Parity.Capture.Staging;

/// <summary>The staged fixture each side of a case opens: one shared copy, or one per side for a case that saves.</summary>
internal sealed record CharacterCopy(string Canonical, string Candidate);
