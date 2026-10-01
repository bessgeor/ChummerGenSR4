using Parity.Cases;
using Parity.Compare.Accounting;
using Parity.Compare.Analysis;
using Parity.Compare.Detection;
using Parity.Compare.Grouping;
using Parity.Compare.Ocr;
using Parity.Compare.Report;
using Parity.Compare.Run;
using Parity.Contracts.CompareReport;
using Parity.Contracts.ExecutionCoverage;
using Parity.Tests.Fakes;
using CompareMode = Parity.Contracts.CompareReport.Mode;

namespace Parity.Tests;

public sealed class CompletenessTests : IDisposable
{
    private readonly CaptureRunFolder _run = new();

    public void Dispose() => _run.Dispose();

    [Fact]
    public void Every_reported_capture_is_complete()
    {
        AddPassing("common");
        AddPassing("skills");
        _run.WriteResults();

        Assert.Equal(0, Execute());

        Parity.Contracts.CompareReport.Completeness completeness = Report().Completeness;
        Assert.True(completeness.Complete);
        Assert.All(completeness.Entries, entry => Assert.Equal(CompletenessState.Reported, entry.State));
        Assert.Equal((2L, 2L, 0L), (completeness.Totals.Planned, completeness.Totals.Reported, completeness.Totals.Unaccounted));
    }

    [Fact]
    public void Performed_capture_without_a_row_is_unaccounted_and_fails_the_analysis()
    {
        AddPassing("common");
        _run.Plan("skills", Outcome.Performed, Outcome.Performed);
        _run.WriteResults();

        Assert.Equal(2, Execute());

        CompareReport report = Report();
        Assert.Equal(ReportStatus.AnalysisFailures, report.Status);
        Assert.False(report.Completeness.Complete);
        CompletenessEntry entry = report.Completeness.Entries[1];
        Assert.Equal(("skills", CompletenessState.Unaccounted), (entry.Capture, entry.State));
        Assert.Equal("canonical performed, candidate performed, but the report has no row for it", entry.Detail);
    }

    [Fact]
    public void Capture_lost_to_an_execution_failure_does_not_change_the_status()
    {
        AddPassing("common");
        _run.Plan("skills", Outcome.Performed, Outcome.NotRun);
        _run.Plan("gear", Outcome.Failed, Outcome.Performed);
        _run.WriteResults();

        Assert.Equal(0, Execute());

        CompareReport report = Report();
        Assert.Equal(ReportStatus.Clear, report.Status);
        Assert.True(report.Completeness.Complete);
        Assert.Equal(
            [CompletenessState.Reported, CompletenessState.ExecutionLost, CompletenessState.ExecutionLost],
            report.Completeness.Entries.Select(entry => entry.State));
        Assert.Equal("canonical performed, candidate not-run", report.Completeness.Entries[1].Detail);
        Assert.Equal(2, report.Completeness.Totals.ExecutionLost);
    }

    [Fact]
    public void Filtered_and_optional_absent_captures_are_accounted_for()
    {
        AddPassing("common");
        _run.Plan("skills", Outcome.Filtered, Outcome.Filtered);
        _run.Plan("adept-powers", Outcome.SkippedOptional, Outcome.SkippedOptional);
        _run.WriteResults();

        Assert.Equal(0, Execute());

        Parity.Contracts.CompareReport.Completeness completeness = Report().Completeness;
        Assert.Equal(
            [CompletenessState.Reported, CompletenessState.Filtered, CompletenessState.OptionalAbsent],
            completeness.Entries.Select(entry => entry.State));
        Assert.Equal((1L, 1L), (completeness.Totals.Filtered, completeness.Totals.OptionalAbsent));
    }

    [Fact]
    public void Optional_tab_absent_on_one_side_only_without_a_row_is_unaccounted()
    {
        AddPassing("common");
        _run.Plan("adept-powers", Outcome.SkippedOptional, Outcome.Performed);
        _run.WriteResults();

        Assert.Equal(2, Execute());

        Assert.Equal(CompletenessState.Unaccounted, Report().Completeness.Entries[1].State);
    }

    [Fact]
    public void Failed_row_is_an_analysis_failure_entry()
    {
        using Bitmap image = CaptureRunFolder.Image(10, 10);
        _run.AddMissingCandidate("spells", image);
        File.Delete(Path.Combine(_run.Root, "captures", "build-test", "canonical", "spells.png"));
        _run.WriteResults();

        Assert.Equal(2, Execute());

        Assert.Equal(CompletenessState.AnalysisFailed, Assert.Single(Report().Completeness.Entries).State);
    }

    [Fact]
    public void Row_that_no_case_planned_is_unaccounted()
    {
        ExecutionCoverage coverage = new() { RunId = "test-run", Valid = true, InvalidReasons = [], Cases = [], Totals = new CoverageTotals() };
        ReportRow row = new()
        {
            Case = "build-test",
            CharacterFile = "test.chum",
            Mode = CompareMode.Build,
            Capture = "common",
            Status = RowStatus.Passed,
            Difference = 0,
            Discrepancies = [],
        };

        Parity.Contracts.CompareReport.Completeness completeness = new CompletenessBuilder().Build(coverage, [row]);

        CompletenessEntry entry = Assert.Single(completeness.Entries);
        Assert.Equal(CompletenessState.Unaccounted, entry.State);
        Assert.Contains("no case of the run planned", entry.Detail);
        Assert.False(completeness.Complete);
        Assert.Equal(0, completeness.Totals.Planned);
    }

    [Fact]
    public void Run_without_coverage_is_a_setup_error()
    {
        AddPassing("common");
        _run.WriteResults();
        File.Delete(Path.Combine(_run.Root, "coverage.json"));

        Assert.Equal(3, Execute());
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    [Fact]
    public void Unreadable_coverage_is_a_setup_error()
    {
        AddPassing("common");
        _run.WriteResults();
        File.WriteAllText(Path.Combine(_run.Root, "coverage.json"), "{ \"runId\": \"test-run\" }");

        Assert.Equal(3, Execute());
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    [Fact]
    public void Coverage_of_another_run_is_a_setup_error()
    {
        AddPassing("common");
        _run.RunId = "other-run";
        _run.WriteResults();

        Assert.Equal(3, Execute());
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    private void AddPassing(string capture)
    {
        using Bitmap image = CaptureRunFolder.Image(20, 10);
        _run.Add(capture, image, image);
    }

    private int Execute() =>
        new CompareRun(
            new CompareOptionsParser(),
            new ScriptedOcrEngine(_ => OcrReadings.Text("x")),
            new RowAnalyzer(new DiscrepancyLocator(new RegionFinder(), new CropExpander()), new ImageHasher()),
            new DuplicateGrouper(),
            new ReportBuilder(new CompletenessBuilder()),
            new ReportPrinter(Console.Out)).Execute(["--run", _run.Root]);

    private CompareReport Report() => ContractJson.ReadReport(File.ReadAllText(Path.Combine(_run.Root, "compare", "report.json")));
}
