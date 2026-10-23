using System.Text;
using System.Text.Json;
using Parity.Cases;
using Parity.Compare.Analysis;
using Parity.Compare.Grouping;
using Parity.Compare.Ocr;
using Parity.Compare.Report;
using Parity.Contracts.CompareReport;
using CaptureResults = Parity.Contracts.CaptureResults.CaptureResults;

namespace Parity.Compare.Run;

/// <summary>
/// One comparer run: read and check the capture run's results, start OCR, replace the run's
/// <c>compare/</c> folder, analyze every row, group duplicates, and write and print the report.
/// </summary>
internal sealed class CompareRun(
    CompareOptionsParser parser,
    IOcrEngineFactory ocrFactory,
    RowAnalyzer analyzer,
    DuplicateGrouper grouper,
    ReportBuilder builder,
    ReportPrinter printer)
{
    public const int SetupError = 3;

    private static readonly UTF8Encoding Utf8 = new(encoderShouldEmitUTF8Identifier: false);

    public int Execute(IReadOnlyList<string> args)
    {
        CompareOptions options;
        try
        {
            options = parser.Parse(args);
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine($"ERROR: {error.Message}");
            Console.Error.WriteLine(CompareOptionsParser.Usage);
            return SetupError;
        }

        if (options.Help)
        {
            Console.WriteLine(CompareOptionsParser.Usage);
            return 0;
        }

        RunFolder folder;
        CaptureResults results;
        IOcrEngine ocr;
        try
        {
            folder = RunFolder.At(options.Run!);
            results = ReadResults(folder);
            ocr = ocrFactory.Create(options.Ocr, options.Tessdata);
        }
        catch (Exception error)
        {
            // Unreadable input or an OCR engine that cannot start: a setup error, and no report.
            Console.Error.WriteLine($"ERROR: {error.Message}");
            return SetupError;
        }

        CompareReport report;
        using (ocr)
        {
            Console.WriteLine($"Compare run {results.RunId}: {folder.Root}");
            Console.WriteLine(ocr.Language is null ? "OCR: disabled" : $"OCR: {ocr.Language}");
            try
            {
                report = Analyze(results, folder, ocr);
            }
            catch (Exception error)
            {
                // Replacing the folder, grouping or writing the report failed: there is no complete report,
                // so no partial compare/ folder is left behind either.
                Console.Error.WriteLine($"ERROR: {error}");
                RemovePartialOutput(folder);
                return SetupError;
            }
        }

        try
        {
            printer.Print(report, folder.ReportPath);
        }
        catch (Exception error)
        {
            // The report is complete and stays; only its summary on the console is missing.
            Console.Error.WriteLine($"ERROR: the report {folder.ReportPath} was written but could not be printed: {error}");
            return SetupError;
        }

        return ReportBuilder.ExitCode(report.Status);
    }

    private CompareReport Analyze(CaptureResults results, RunFolder folder, IOcrEngine ocr)
    {
        if (Directory.Exists(folder.CompareDirectory))
        {
            Directory.Delete(folder.CompareDirectory, recursive: true);
        }

        Directory.CreateDirectory(folder.CompareDirectory);
        List<RowAnalysis> rows = results.Results.Select(row => analyzer.Analyze(row, folder, ocr)).ToList();
        IReadOnlyList<IReadOnlyList<Finding>> groups = grouper.Group(rows.SelectMany(row => row.Findings).ToList());
        CompareReport report = builder.Build(results, ocr.Language, rows, groups);
        File.WriteAllText(folder.ReportPath, ContractJson.Write(report) + "\n", Utf8);
        return report;
    }

    private static void RemovePartialOutput(RunFolder folder)
    {
        try
        {
            if (Directory.Exists(folder.CompareDirectory))
            {
                Directory.Delete(folder.CompareDirectory, recursive: true);
            }
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            Console.Error.WriteLine($"ERROR: the partial output {folder.CompareDirectory} could not be removed: {error.Message}");
        }
    }

    /// <summary>Reads <c>results.json</c> strictly and checks that every capture path stays inside the run folder.</summary>
    private static CaptureResults ReadResults(RunFolder folder)
    {
        if (!File.Exists(folder.ResultsPath))
        {
            throw new CompareSetupException($"{folder.ResultsPath} does not exist; pass a capture run folder that has results.");
        }

        CaptureResults results;
        try
        {
            results = ContractJson.ReadResults(File.ReadAllText(folder.ResultsPath));
        }
        catch (JsonException error)
        {
            throw new CompareSetupException($"{folder.ResultsPath} is not valid capture results: {error.Message}");
        }

        foreach (string path in results.Results.SelectMany(row => new[] { row.CanonicalCapture, row.CandidateCapture }).OfType<string>())
        {
            folder.Resolve(path);
        }

        return results;
    }
}
