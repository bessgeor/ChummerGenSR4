using Parity.Contracts.CompareReport;

namespace Parity.Compare.Report;

/// <summary>Prints the rows that did not pass, the duplicate groups and the totals.</summary>
internal sealed class ReportPrinter
{
    public void Print(CompareReport report, string reportPath)
    {
        Console.WriteLine("Rows:");
        foreach (ReportRow row in report.Rows.Where(row => row.Status != RowStatus.Passed))
        {
            Console.WriteLine($"  {Label(row.Status),-6} {row.Case}/{row.Capture}: {Detail(row)}");
        }

        Dictionary<string, Discrepancy> byId = report.Discrepancies.ToDictionary(item => item.Id, StringComparer.Ordinal);
        Console.WriteLine($"Groups: {report.Groups.Count}");
        foreach (DiscrepancyGroup group in report.Groups)
        {
            Discrepancy representative = byId[group.Representative];
            Console.WriteLine($"  {group.Members.Count,3} × {group.Representative} {Rect(representative.Core)}: " +
                              $"{Text(representative.CanonicalOcr)} → {Text(representative.CandidateOcr)}");
        }

        ReportTotals totals = report.Totals;
        Console.WriteLine($"Totals: rows {totals.Rows}, passed {totals.Passed}, analyzed {totals.Analyzed}, size mismatches {totals.SizeMismatches}, " +
                          $"missing {totals.Missing}, failed {totals.Failed}, discrepancies {totals.Discrepancies}, groups {totals.Groups}, OCR errors {totals.OcrErrors}");
        Console.WriteLine($"Status: {Status(report.Status)} (exit {ReportBuilder.ExitCode(report.Status)})");
        Console.WriteLine($"Report: {reportPath}");
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

    private static string Status(ReportStatus status) => status switch
    {
        ReportStatus.Clear => "clear",
        ReportStatus.Differences => "differences",
        _ => "analysis-failures",
    };

    private static string Rect(PixelRect rect) => $"({rect.X},{rect.Y} {rect.Width}×{rect.Height})";

    private static string Size(ImageSize? size) => size is null ? "?" : $"{size.Width}×{size.Height}";
}
