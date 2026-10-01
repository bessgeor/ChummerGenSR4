using System.Drawing.Imaging;
using Parity.Cases;
using Parity.Contracts.CaptureResults;
using Parity.Contracts.ExecutionCoverage;
using Parity.Imaging;
using Mode = Parity.Contracts.CaptureResults.Mode;

namespace Parity.Tests.Fakes;

/// <summary>
/// A temporary capture run folder: generated capture pairs, a <c>results.json</c> whose rows record
/// the difference the capture runner would record for them, and a <c>coverage.json</c> that plans every
/// row's capture as performed on both sides, plus the captures planned with <see cref="Plan"/>.
/// </summary>
internal sealed class CaptureRunFolder : IDisposable
{
    private readonly List<CaptureResult> _rows = [];
    private readonly List<(string Case, string Capture, Outcome Canonical, Outcome Candidate)> _plan = [];

    public string Root { get; } = Directory.CreateTempSubdirectory("parity-compare-").FullName;

    public string RunId { get; set; } = "test-run";

    public void Dispose() => Directory.Delete(Root, recursive: true);

    /// <summary>A white image of the given size, drawn on by <paramref name="draw"/>.</summary>
    public static Bitmap Image(int width, int height, Action<Graphics>? draw = null)
    {
        Bitmap bitmap = new(width, height, PixelFormat.Format32bppArgb);
        using Graphics graphics = Graphics.FromImage(bitmap);
        graphics.Clear(Color.White);
        draw?.Invoke(graphics);
        return bitmap;
    }

    /// <summary>Adds a row whose reason and difference follow from the two images and the threshold.</summary>
    public CaptureResult Add(string capture, Bitmap canonical, Bitmap candidate, double threshold = 0.00004, string caseName = "build-test")
    {
        string canonicalPath = Save(caseName, "canonical", capture, canonical);
        string candidatePath = Save(caseName, "candidate", capture, candidate);
        ArgbImage left = ArgbImage.FromBitmap(canonical);
        ArgbImage right = ArgbImage.FromBitmap(candidate);
        double difference = left.Size == right.Size ? Math.Round(PixelDifference.Of(left, right).Ratio, 6) : 1.0;
        CaptureResult row = Row(caseName, capture, difference <= threshold ? ResultReason.WithinThreshold : ResultReason.VisualDifference, difference);
        row.CanonicalCapture = canonicalPath;
        row.CandidateCapture = candidatePath;
        row.CanonicalSize = new ImageSize { Width = canonical.Width, Height = canonical.Height };
        row.CandidateSize = new ImageSize { Width = candidate.Width, Height = candidate.Height };
        _rows.Add(row);
        return row;
    }

    /// <summary>Adds a row for a capture that only the canonical side produced.</summary>
    public CaptureResult AddMissingCandidate(string capture, Bitmap canonical, string caseName = "build-test")
    {
        CaptureResult row = Row(caseName, capture, ResultReason.MissingCandidate, 1.0);
        row.CanonicalCapture = Save(caseName, "canonical", capture, canonical);
        row.CanonicalSize = new ImageSize { Width = canonical.Width, Height = canonical.Height };
        _rows.Add(row);
        return row;
    }

    /// <summary>Plans a capture that has no row, with each side's outcome.</summary>
    public void Plan(string capture, Outcome canonical, Outcome candidate, string caseName = "build-test") =>
        _plan.Add((caseName, capture, canonical, candidate));

    /// <summary>Writes <c>results.json</c> with every row and <c>coverage.json</c> planning every row and planned capture.</summary>
    public void WriteResults()
    {
        File.WriteAllText(Path.Combine(Root, "results.json"), ContractJson.Write(new CaptureResults { RunId = "test-run", Threshold = 0.00004, Results = _rows }));
        List<(string Case, string Capture, Outcome Canonical, Outcome Candidate)> plan =
            [.. _rows.Select(row => (row.Case, row.Capture, Outcome.Performed, Outcome.Performed)), .. _plan];
        ExecutionCoverage coverage = new()
        {
            RunId = RunId,
            Valid = true,
            InvalidReasons = [],
            Cases = plan.GroupBy(item => item.Case).Select(group => new CaseCoverage
            {
                Case = group.Key,
                CharacterFile = "test.chum",
                Mode = Parity.Contracts.ExecutionCoverage.Mode.Build,
                PlannedActions = group.Count(),
                PlannedCaptures = group.Select(item => item.Capture).ToList(),
                Sides =
                [
                    SideOf(Side.Canonical, group.Select(item => (item.Capture, item.Canonical)).ToList()),
                    SideOf(Side.Candidate, group.Select(item => (item.Capture, item.Candidate)).ToList()),
                ],
            }).ToList(),
            Totals = new CoverageTotals(),
        };
        File.WriteAllText(Path.Combine(Root, "coverage.json"), ContractJson.Write(coverage));
    }

    private static SideCoverage SideOf(Side side, List<(string Capture, Outcome Outcome)> captures) => new()
    {
        Side = side,
        Source = Source.Live,
        RecordedActions = captures.Count,
        Contiguous = true,
        Failures = [],
        OptionalAbsent = [],
        SkippedOptional = [],
        Captures = captures.Select(item => new CaptureCoverage { Capture = item.Capture, Outcome = item.Outcome, File = item.Outcome == Outcome.Performed }).ToList(),
    };

    private static CaptureResult Row(string caseName, string capture, ResultReason reason, double difference) => new()
    {
        Case = caseName,
        CharacterFile = "test.chum",
        Mode = Mode.Build,
        Capture = capture,
        Passed = reason == ResultReason.WithinThreshold,
        Reason = reason,
        Difference = difference,
    };

    private string Save(string caseName, string side, string capture, Bitmap image)
    {
        string relative = $"captures/{caseName}/{side}/{capture}.png";
        string path = Path.Combine(Root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        image.Save(path, ImageFormat.Png);
        return relative;
    }
}
