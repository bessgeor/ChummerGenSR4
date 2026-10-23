namespace Parity.Capture.Execution;

/// <summary>The outcome of the action at <paramref name="Index"/> of a case, on one side.</summary>
internal sealed record ActionRecord(int Index, string Action, bool Required, OutcomeKind Outcome, string? Reason);
