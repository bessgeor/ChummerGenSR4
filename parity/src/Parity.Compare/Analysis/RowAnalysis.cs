using Parity.Contracts.CompareReport;
using CaptureResult = Parity.Contracts.CaptureResults.CaptureResult;

namespace Parity.Compare.Analysis;

/// <summary>The comparer's outcome for one row of <c>results.json</c>.</summary>
internal sealed record RowAnalysis(CaptureResult Row, RowStatus Status, long? DifferingPixels, string? Failure, IReadOnlyList<Finding> Findings)
{
    public static RowAnalysis Without(CaptureResult row, RowStatus status) => new(row, status, null, null, []);

    public static RowAnalysis Failed(CaptureResult row, string failure) => new(row, RowStatus.Failed, null, failure, []);

    public static RowAnalysis Analyzed(CaptureResult row, long differingPixels, IReadOnlyList<Finding> findings) =>
        new(row, RowStatus.Analyzed, differingPixels, null, findings);
}
