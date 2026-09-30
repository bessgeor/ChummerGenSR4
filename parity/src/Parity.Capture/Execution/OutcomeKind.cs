namespace Parity.Capture.Execution;

/// <summary>What happened to one action on one side.</summary>
internal enum OutcomeKind
{
    Performed,
    Failed,
    OptionalAbsent,
    SkippedOptional,
    Filtered,
    NotRun,
}
