using Parity.Compare.Accounting;
using Parity.Compare.Analysis;
using Parity.Contracts.CompareReport;
using CaptureResults = Parity.Contracts.CaptureResults.CaptureResults;
using CapturedMode = Parity.Contracts.CaptureResults.Mode;
using CapturedSize = Parity.Contracts.CaptureResults.ImageSize;
using ExecutionCoverage = Parity.Contracts.ExecutionCoverage.ExecutionCoverage;

namespace Parity.Compare.Report;

/// <summary>Maps the analyzed rows, their duplicate groups and the completeness of the run to the report contract, with totals and status.</summary>
internal sealed class ReportBuilder(CompletenessBuilder completeness)
{
    public CompareReport Build(
        CaptureResults results,
        ExecutionCoverage coverage,
        string? ocrLanguage,
        IReadOnlyList<RowAnalysis> rows,
        IReadOnlyList<IReadOnlyList<Finding>> groups)
    {
        Dictionary<string, string> representatives = groups
            .SelectMany(group => group.Select(member => (member.Id, Representative: group[0].Id)))
            .ToDictionary(pair => pair.Id, pair => pair.Representative, StringComparer.Ordinal);
        List<Finding> findings = rows.SelectMany(row => row.Findings).ToList();
        ReportTotals totals = new()
        {
            Rows = rows.Count,
            Passed = rows.Count(row => row.Status == RowStatus.Passed),
            Analyzed = rows.Count(row => row.Status == RowStatus.Analyzed),
            SizeMismatches = rows.Count(row => row.Status == RowStatus.SizeMismatch),
            Missing = rows.Count(row => row.Status is RowStatus.MissingCanonical or RowStatus.MissingCandidate),
            Failed = rows.Count(row => row.Status == RowStatus.Failed),
            Discrepancies = findings.Count,
            Groups = groups.Count,
            OcrErrors = findings.Sum(finding => (finding.CanonicalOcr.Status == OcrStatus.Error ? 1 : 0) + (finding.CandidateOcr.Status == OcrStatus.Error ? 1 : 0)),
        };
        List<ReportRow> reportRows = rows.Select(Row).ToList();
        Completeness accounted = completeness.Build(coverage, reportRows);
        return new CompareReport
        {
            RunId = results.RunId,
            Threshold = results.Threshold,
            Ocr = new OcrSettings { Enabled = ocrLanguage is not null, Language = ocrLanguage },
            Status = Status(totals, accounted),
            Rows = reportRows,
            Discrepancies = findings.Select(finding => Discrepancy(finding, representatives[finding.Id])).ToList(),
            Groups = groups.Select(group => new DiscrepancyGroup
            {
                Representative = group[0].Id,
                Members = group.Select(member => member.Id).ToList(),
            }).ToList(),
            Totals = totals,
            Completeness = accounted,
        };
    }

    /// <summary>A failed row, an OCR error or an unaccounted planned capture is an analysis failure.</summary>
    public static ReportStatus Status(ReportTotals totals, Completeness completeness)
    {
        if (totals.Failed > 0 || totals.OcrErrors > 0 || !completeness.Complete)
        {
            return ReportStatus.AnalysisFailures;
        }

        return totals.Passed == totals.Rows ? ReportStatus.Clear : ReportStatus.Differences;
    }

    public static int ExitCode(ReportStatus status) => status switch
    {
        ReportStatus.Clear => 0,
        ReportStatus.Differences => 1,
        ReportStatus.AnalysisFailures => 2,
        _ => throw new ArgumentOutOfRangeException(nameof(status), status, null),
    };

    private static ReportRow Row(RowAnalysis analysis) => new()
    {
        Case = analysis.Row.Case,
        CharacterFile = analysis.Row.CharacterFile,
        Mode = analysis.Row.Mode == CapturedMode.Career ? Mode.Career : Mode.Build,
        Capture = analysis.Row.Capture,
        Status = analysis.Status,
        Difference = analysis.Row.Difference,
        DifferingPixels = analysis.DifferingPixels,
        Failure = analysis.Failure,
        CanonicalCapture = analysis.Row.CanonicalCapture,
        CandidateCapture = analysis.Row.CandidateCapture,
        CanonicalSize = Size(analysis.Row.CanonicalSize),
        CandidateSize = Size(analysis.Row.CandidateSize),
        Discrepancies = analysis.Findings.Select(finding => finding.Id).ToList(),
    };

    private static Discrepancy Discrepancy(Finding finding, string representative) => new()
    {
        Id = finding.Id,
        Case = finding.Case,
        Capture = finding.Capture,
        Core = Rect(finding.Core),
        Crop = Rect(finding.Crop),
        DifferingPixels = finding.DifferingPixels,
        ImageHash = finding.ImageHash,
        CanonicalCrop = finding.CanonicalCrop,
        CandidateCrop = finding.CandidateCrop,
        CanonicalOcr = finding.CanonicalOcr,
        CandidateOcr = finding.CandidateOcr,
        Representative = representative,
    };

    private static PixelRect Rect(Rectangle region) => new() { X = region.X, Y = region.Y, Width = region.Width, Height = region.Height };

    private static ImageSize? Size(CapturedSize? size) => size is null ? null : new ImageSize { Width = size.Width, Height = size.Height };
}
