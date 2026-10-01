using Microsoft.Extensions.DependencyInjection;
using Parity.Cases;
using Parity.Compare.Analysis;
using Parity.Compare.Detection;
using Parity.Compare.Grouping;
using Parity.Compare.Ocr;
using Parity.Compare.Report;
using Parity.Compare.Run;
using Parity.Contracts.CompareReport;
using Parity.Tests.Fakes;
using CaptureResult = Parity.Contracts.CaptureResults.CaptureResult;

namespace Parity.Tests;

public sealed class CompareRunTests : IDisposable
{
    private readonly CaptureRunFolder _run = new();

    public void Dispose() => _run.Dispose();

    [Fact]
    public void Composition_root_resolves_the_run() =>
        Assert.NotNull(Parity.Compare.Program.BuildServices().GetRequiredService<CompareRun>());

    [Fact]
    public void Every_row_passed_is_clear()
    {
        using Bitmap image = CaptureRunFolder.Image(60, 40);
        _run.Add("common", image, image);
        _run.WriteResults();

        Assert.Equal(0, Execute(Text("x")));

        CompareReport report = Report();
        Assert.Equal(ReportStatus.Clear, report.Status);
        Assert.Equal(RowStatus.Passed, Assert.Single(report.Rows).Status);
        Assert.Empty(report.Discrepancies);
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare", "crops")));
    }

    [Fact]
    public void A_single_changed_pixel_is_one_discrepancy_with_crops()
    {
        using Bitmap canonical = CaptureRunFolder.Image(300, 200);
        using Bitmap candidate = CaptureRunFolder.Image(300, 200);
        candidate.SetPixel(150, 100, Color.FromArgb(10, 20, 30));
        _run.Add("common", canonical, candidate, threshold: 0);
        _run.WriteResults();

        Assert.Equal(1, Execute(Text("x")));

        CompareReport report = Report();
        ReportRow row = Assert.Single(report.Rows);
        Assert.Equal((RowStatus.Analyzed, 1L), (row.Status, row.DifferingPixels));
        Discrepancy discrepancy = Assert.Single(report.Discrepancies);
        Assert.Equal("build-test/common#1", discrepancy.Id);
        Assert.Equal([discrepancy.Id], row.Discrepancies);
        Assert.Equal((150L, 100L, 1L, 1L), (discrepancy.Core.X, discrepancy.Core.Y, discrepancy.Core.Width, discrepancy.Core.Height));
        Assert.Equal(1, discrepancy.DifferingPixels);
        Assert.Equal(discrepancy.Id, discrepancy.Representative);
        Assert.Matches("^[0-9a-f]{64}$", discrepancy.ImageHash);
        foreach (string crop in new[] { discrepancy.CanonicalCrop, discrepancy.CandidateCrop })
        {
            using Bitmap saved = new(Path.Combine(_run.Root, crop));
            Assert.Equal(new Size((int)discrepancy.Crop.Width, (int)discrepancy.Crop.Height), saved.Size);
        }
    }

    [Fact]
    public void A_recorded_difference_that_disagrees_with_the_pixels_is_an_analysis_failure()
    {
        using Bitmap canonical = CaptureRunFolder.Image(100, 100);
        using Bitmap candidate = CaptureRunFolder.Image(100, 100);
        candidate.SetPixel(1, 1, Color.Black);
        CaptureResult row = _run.Add("common", canonical, candidate, threshold: 0);
        row.Difference = 0.5;
        _run.WriteResults();

        Assert.Equal(2, Execute(Text("x")));

        ReportRow reported = Assert.Single(Report().Rows);
        Assert.Equal(RowStatus.Failed, reported.Status);
        Assert.Contains("0.0001", reported.Failure);
        Assert.Contains("0.5", reported.Failure);
        Assert.Equal(ReportStatus.AnalysisFailures, Report().Status);
    }

    [Fact]
    public void Size_mismatches_and_missing_captures_keep_their_own_status()
    {
        using Bitmap small = CaptureRunFolder.Image(100, 50);
        using Bitmap tall = CaptureRunFolder.Image(100, 60);
        _run.Add("skills", small, tall);
        _run.AddMissingCandidate("spells", small);
        _run.WriteResults();

        Assert.Equal(1, Execute(Text("x")));

        CompareReport report = Report();
        Assert.Collection(
            report.Rows,
            size =>
            {
                Assert.Equal(RowStatus.SizeMismatch, size.Status);
                Assert.Equal((100L, 60L), (size.CandidateSize!.Width, size.CandidateSize.Height));
                Assert.Empty(size.Discrepancies);
            },
            missing => Assert.Equal(RowStatus.MissingCandidate, missing.Status));
        Assert.Equal((1L, 1L), (report.Totals.SizeMismatches, report.Totals.Missing));
    }

    [Fact]
    public void A_missing_capture_row_whose_present_capture_is_gone_fails()
    {
        using Bitmap image = CaptureRunFolder.Image(10, 10);
        CaptureResult row = _run.AddMissingCandidate("spells", image);
        File.Delete(Path.Combine(_run.Root, row.CanonicalCapture!));
        _run.WriteResults();

        Assert.Equal(2, Execute(Text("x")));

        ReportRow reported = Assert.Single(Report().Rows);
        Assert.Equal(RowStatus.Failed, reported.Status);
        Assert.Contains("does not exist", reported.Failure);
    }

    [Fact]
    public void Without_results_there_is_no_report()
    {
        Assert.Equal(3, Execute(Text("x")));

        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    [Fact]
    public void A_capture_path_outside_the_run_folder_is_a_setup_error()
    {
        using Bitmap image = CaptureRunFolder.Image(10, 10);
        _run.Add("common", image, image).CanonicalCapture = "../elsewhere.png";
        _run.WriteResults();

        Assert.Equal(3, Execute(Text("x")));
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    [Fact]
    public void Missing_run_option_is_a_setup_error() =>
        Assert.Equal(3, Compare(Text("x")).Execute([]));

    [Fact]
    public void Missing_language_data_is_a_setup_error()
    {
        using Bitmap image = CaptureRunFolder.Image(10, 10);
        _run.Add("common", image, image);
        _run.WriteResults();

        int exit = Compare(new OcrEngineFactory(new OcrImagePreparer())).Execute(["--run", _run.Root, "--tessdata", Path.Combine(_run.Root, "none")]);

        Assert.Equal(3, exit);
        Assert.False(Directory.Exists(Path.Combine(_run.Root, "compare")));
    }

    [Fact]
    public void A_rerun_replaces_the_compare_folder()
    {
        using Bitmap image = CaptureRunFolder.Image(10, 10);
        _run.Add("common", image, image);
        _run.WriteResults();
        string stray = Path.Combine(_run.Root, "compare", "stray.txt");
        Directory.CreateDirectory(Path.GetDirectoryName(stray)!);
        File.WriteAllText(stray, "old");

        Assert.Equal(0, Execute(Text("x")));
        Assert.False(File.Exists(stray));
    }

    [Fact]
    public void Without_ocr_every_reading_is_disabled()
    {
        AddChange("common", "40", "45");
        _run.WriteResults();

        Assert.Equal(1, Execute(Text("x"), "--no-ocr"));

        CompareReport report = Report();
        Assert.False(report.Ocr.Enabled);
        Assert.Null(report.Ocr.Language);
        Assert.All(report.Discrepancies, item => Assert.Equal((OcrStatus.Disabled, OcrStatus.Disabled), (item.CanonicalOcr.Status, item.CandidateOcr.Status)));
    }

    [Fact]
    public void An_ocr_error_is_recorded_and_fails_the_analysis()
    {
        AddChange("common", "40", "45");
        _run.WriteResults();

        Assert.Equal(2, Execute(new ScriptedOcrEngine(_ => OcrReadings.Error(new InvalidOperationException("engine broke")))));

        CompareReport report = Report();
        Discrepancy discrepancy = Assert.Single(report.Discrepancies);
        Assert.Equal(OcrStatus.Error, discrepancy.CanonicalOcr.Status);
        Assert.Equal("InvalidOperationException: engine broke", discrepancy.CanonicalOcr.Error);
        Assert.Equal(ReportStatus.AnalysisFailures, report.Status);
        Assert.Equal(2, report.Totals.OcrErrors);
    }

    [Fact]
    public void An_ocr_engine_that_throws_is_recorded_as_an_error()
    {
        AddChange("common", "40", "45");
        _run.WriteResults();

        Assert.Equal(2, Execute(new ScriptedOcrEngine(_ => throw new NullReferenceException("native read failed"))));

        CompareReport report = Report();
        Discrepancy discrepancy = Assert.Single(report.Discrepancies);
        Assert.Equal((OcrStatus.Error, OcrStatus.Error), (discrepancy.CanonicalOcr.Status, discrepancy.CandidateOcr.Status));
        Assert.Equal("NullReferenceException: native read failed", discrepancy.CandidateOcr.Error);
        Assert.Equal(ReportStatus.AnalysisFailures, report.Status);
    }

    [Fact]
    public void A_crop_that_cannot_be_written_fails_its_row()
    {
        CaptureResult row = AddChange("common", "40", "45");
        // A file where the case's crop folder belongs makes writing the crops fail.
        Directory.CreateDirectory(Path.Combine(_run.Root, "compare", "crops"));
        File.WriteAllText(Path.Combine(_run.Root, "compare", "crops", "build-test"), "not a folder");

        RowAnalysis analysis = Analyzer().Analyze(row, RunFolder.At(_run.Root), Text("x"));

        Assert.Equal(RowStatus.Failed, analysis.Status);
        Assert.StartsWith("The row could not be analyzed: IOException:", analysis.Failure);
        Assert.Empty(analysis.Findings);
    }

    [Fact]
    public void A_crop_that_cannot_be_written_leaves_none_of_its_rows_crops()
    {
        using Bitmap canonical = CaptureRunFolder.Image(300, 200);
        using Bitmap candidate = CaptureRunFolder.Image(300, 200);
        candidate.SetPixel(20, 20, Color.Black);
        candidate.SetPixel(250, 150, Color.Black);
        CaptureResult row = _run.Add("common", canonical, candidate, threshold: 0);
        // A folder where the second discrepancy's canonical crop belongs makes writing that crop fail.
        Directory.CreateDirectory(Path.Combine(_run.Root, "compare", "crops", "build-test", "common.2.canonical.png"));

        RowAnalysis analysis = Analyzer().Analyze(row, RunFolder.At(_run.Root), Text("x"));

        Assert.Equal(RowStatus.Failed, analysis.Status);
        Assert.Empty(analysis.Findings);
        Assert.Empty(Directory.GetFiles(Path.Combine(_run.Root, "compare", "crops"), "*", SearchOption.AllDirectories));
    }

    [Fact]
    public void A_report_that_cannot_be_printed_stays_written()
    {
        AddChange("common", "40", "45");
        _run.WriteResults();

        int exit = Compare(Text("x"), new FailingWriter()).Execute(["--run", _run.Root]);

        Assert.Equal(3, exit);
        Assert.Equal(ReportStatus.Differences, Report().Status);
        Assert.Equal(2, Directory.GetFiles(Path.Combine(_run.Root, "compare", "crops"), "*", SearchOption.AllDirectories).Length);
    }

    [Fact]
    public void An_empty_run_option_is_a_setup_error() =>
        Assert.Equal(3, Compare(Text("x")).Execute(["--run", ""]));

    [Fact]
    public void Empty_text_on_both_sides_widens_the_crop_once()
    {
        AddChange("common", "40", "45");
        _run.WriteResults();
        ScriptedOcrEngine ocr = new(_ => OcrReadings.Empty());

        Assert.Equal(1, Execute(ocr));

        Assert.Equal(4, ocr.Reads.Count);
        Assert.Equal(ocr.Reads[0] + new Size(96, 48), ocr.Reads[2]);
        Discrepancy discrepancy = Assert.Single(Report().Discrepancies);
        Assert.Equal((OcrStatus.Empty, OcrStatus.Empty), (discrepancy.CanonicalOcr.Status, discrepancy.CandidateOcr.Status));
        Assert.Equal(ocr.Reads[2], new Size((int)discrepancy.Crop.Width, (int)discrepancy.Crop.Height));
    }

    [Fact]
    public void The_same_change_on_two_captures_is_one_group()
    {
        AddChange("common", "40", "45");
        AddChange("skills", "40", "45");
        _run.WriteResults();

        Assert.Equal(1, Execute(Text("x")));

        CompareReport report = Report();
        DiscrepancyGroup group = Assert.Single(report.Groups);
        Assert.Equal(["build-test/common#1", "build-test/skills#1"], group.Members);
        Assert.All(report.Discrepancies, item => Assert.Equal("build-test/common#1", item.Representative));
    }

    [Fact]
    public void Different_changes_with_empty_text_are_different_groups()
    {
        AddChange("common", "40", "45");
        AddChange("skills", "40", "50");
        _run.WriteResults();

        Assert.Equal(1, Execute(new ScriptedOcrEngine(_ => OcrReadings.Empty())));

        CompareReport report = Report();
        Assert.Equal(2, report.Groups.Count);
        Assert.Equal(2, report.Totals.Groups);
        Assert.NotEqual(report.Discrepancies[0].ImageHash, report.Discrepancies[1].ImageHash);
    }

    private CaptureResult AddChange(string capture, string before, string after)
    {
        using Bitmap canonical = CaptureRunFolder.Image(400, 200, graphics => DrawValue(graphics, before));
        using Bitmap candidate = CaptureRunFolder.Image(400, 200, graphics => DrawValue(graphics, after));
        return _run.Add(capture, canonical, candidate);
    }

    private static void DrawValue(Graphics graphics, string value)
    {
        using Font font = new("Microsoft Sans Serif", 8.25f);
        graphics.DrawString($"Special Attributes   {value} BP", font, Brushes.Black, 100, 90);
    }

    private static ScriptedOcrEngine Text(string text) => new(_ => OcrReadings.Text(text));

    private int Execute(IOcrEngineFactory ocr, params string[] options) => Compare(ocr).Execute(["--run", _run.Root, .. options]);

    private static RowAnalyzer Analyzer() => new(new DiscrepancyLocator(new RegionFinder(), new CropExpander()), new ImageHasher());

    private static CompareRun Compare(IOcrEngineFactory ocr, TextWriter? output = null) => new(
        new CompareOptionsParser(),
        ocr,
        Analyzer(),
        new DuplicateGrouper(),
        new ReportBuilder(),
        new ReportPrinter(output ?? Console.Out));

    /// <summary>A console that fails on every write.</summary>
    private sealed class FailingWriter : TextWriter
    {
        public override System.Text.Encoding Encoding => System.Text.Encoding.UTF8;

        public override void Write(char value) => throw new IOException("The console is gone.");
    }

    private CompareReport Report() => ContractJson.ReadReport(File.ReadAllText(Path.Combine(_run.Root, "compare", "report.json")));
}
