namespace Parity.Cases;

/// <summary>A loaded and validated case file.</summary>
public sealed record CaseSuite(
    string CaseFilePath,
    int StartupDelaySeconds,
    int SettleMilliseconds,
    IReadOnlyList<ParityCase> Cases);
