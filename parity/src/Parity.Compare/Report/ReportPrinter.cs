using Parity.Cases;
using Parity.Contracts.CompareReport;

namespace Parity.Compare.Report;

/// <summary>Prints the rows that did not pass, the duplicate groups and the totals.</summary>
internal sealed class ReportPrinter(TextWriter output)
{
    public void Print(CompareReport report, string reportPath)
    {
        output.WriteLine("Rows:");
        foreach (ReportRow row in report.Rows.Where(row => row.Status != RowStatus.Passed))
        {
            output.WriteLine($"  {Label(row.Status),-6} {row.Case}/{row.Capture}: {Detail(row)}");
        }

        Dictionary<string, Discrepancy> byId = report.Discrepancies.ToDictionary(item => item.Id, StringComparer.Ordinal);
        output.WriteLine($"Groups: {report.Groups.Count}");
        foreach (DiscrepancyGroup group in report.Groups)
        {
            Discrepancy representative = byId[group.Representative];
            output.WriteLine($"  {group.Members.Count,3} × {group.Representative} {Rect(representative.Core)}: " +
                             $"{Text(representative.CanonicalOcr)} → {Text(representative.CandidateOcr)}");
        }

        CompletenessTotals accounted = report.Completeness.Totals;
        output.WriteLine($"Completeness: {(report.Completeness.Complete ? "complete" : "INCOMPLETE")}; planned {accounted.Planned}, reported {accounted.Reported}, " +
                         $"analysis failed {accounted.AnalysisFailed}, filtered {accounted.Filtered}, optional absent {accounted.OptionalAbsent}, " +
                         $"execution lost {accounted.ExecutionLost}, unaccounted {accounted.Unaccounted}");
        foreach (CompletenessEntry entry in report.Completeness.Entries.Where(entry => entry.State is CompletenessState.Unaccounted or CompletenessState.ExecutionLost))
        {
            output.WriteLine($"  {(entry.State == CompletenessState.Unaccounted ? "UNACCOUNTED" : "LOST"),-11} {entry.Case}/{entry.Capture}: {entry.Detail}");
        }

        ReportTotals totals = report.Totals;
        output.WriteLine($"Totals: rows {totals.Rows}, passed {totals.Passed}, analyzed {totals.Analyzed}, size mismatches {totals.SizeMismatches}, " +
                         $"missing {totals.Missing}, failed {totals.Failed}, discrepancies {totals.Discrepancies}, groups {totals.Groups}, OCR errors {totals.OcrErrors}");
        output.WriteLine($"Status: {ContractJson.Name(report.Status)} (exit {ReportBuilder.ExitCode(report.Status)})");
        output.WriteLine($"Report: {reportPath}");
    }

    private static string Label(RowStatus status) => status switch
    {
        RowStatus.Analyzed => "DIFF",
        RowStatus.SizeMismatch => "SIZE",
        RowStatus.MissingCanonical or RowStatus.MissingCandidate => "MISS",
        RowStatus.Failed => "FAILED",
        _ => status.ToString(),
    };

    private static string Detail(ReportRow row) => row.Status switch
    {
        RowStatus.Analyzed => $"{row.Discrepancies.Count} discrepancies, {row.DifferingPixels} differing pixels",
        RowStatus.SizeMismatch => $"{Size(row.CanonicalSize)} vs {Size(row.CandidateSize)}",
        RowStatus.MissingCanonical => $"only the candidate captured it ({row.CandidateCapture})",
        RowStatus.MissingCandidate => $"only the canonical captured it ({row.CanonicalCapture})",
        RowStatus.Failed => row.Failure ?? string.Empty,
        _ => string.Empty,
    };

    private static string Text(OcrReading reading) => reading.Status switch
    {
        OcrStatus.Text => $"\"{reading.Text!.Replace("\n", " | ")}\"",
        OcrStatus.Error => $"[error: {reading.Error}]",
        OcrStatus.Empty => "[empty]",
        _ => "[disabled]",
    };

    private static string Rect(PixelRect rect) => $"({rect.X},{rect.Y} {rect.Width}×{rect.Height})";

    private static string Size(ImageSize? size) => size is null ? "?" : $"{size.Width}×{size.Height}";
}
