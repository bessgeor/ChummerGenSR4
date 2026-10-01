namespace Parity.Compare.Run;

/// <summary>A problem with the comparer's input or environment; the run ends with status 3 and writes no report.</summary>
internal sealed class CompareSetupException(string message) : Exception(message);
