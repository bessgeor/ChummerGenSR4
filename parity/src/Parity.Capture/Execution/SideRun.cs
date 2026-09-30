namespace Parity.Capture.Execution;

/// <summary>
/// One side (canonical or candidate) of a case: an outcome for every action, the captures it wrote
/// (capture name to PNG path), and the error that stopped it, if any.
/// </summary>
internal sealed record SideRun(
    string Side,
    IReadOnlyList<ActionRecord> Actions,
    IReadOnlyDictionary<string, string> Captures,
    string? Failure,
    TimeSpan Duration)
{
    public bool Failed => Failure is not null;

    /// <summary>The outcome of the capture action with this name.</summary>
    public OutcomeKind CaptureOutcome(string captureName) =>
        Actions.Single(action => action.Action == $"capture:{captureName}").Outcome;
}
