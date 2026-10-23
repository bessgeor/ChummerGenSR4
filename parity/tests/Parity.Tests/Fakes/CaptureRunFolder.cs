using System.Drawing.Imaging;
using Parity.Cases;
using Parity.Contracts.CaptureResults;
using Parity.Imaging;

namespace Parity.Tests.Fakes;

/// <summary>
/// A temporary capture run folder: generated capture pairs and a <c>results.json</c> whose rows record
/// the difference the capture runner would record for them.
/// </summary>
internal sealed class CaptureRunFolder : IDisposable
{
    private readonly List<CaptureResult> _rows = [];

    public string Root { get; } = Directory.CreateTempSubdirectory("parity-compare-").FullName;

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

    public void WriteResults() =>
        File.WriteAllText(Path.Combine(Root, "results.json"), ContractJson.Write(new CaptureResults { RunId = "test-run", Threshold = 0.00004, Results = _rows }));

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
