using System.Drawing.Imaging;
using Parity.Capture.Execution;
using Parity.Cases;
using Parity.Contracts.CaptureResults;

namespace Parity.Tests;

public sealed class VisualResultTests : IDisposable
{
    private readonly string _directory = Directory.CreateTempSubdirectory("parity-visual-").FullName;
    private readonly PixelComparer _comparer = new();

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Identical_images_do_not_differ()
    {
        ImageComparison comparison = _comparer.Compare(Image("a", 10, 10), Image("b", 10, 10));

        Assert.Equal(0, comparison.Difference);
    }

    [Fact]
    public void Difference_is_the_share_of_changed_pixels()
    {
        ImageComparison comparison = _comparer.Compare(Image("a", 10, 10), Image("b", 10, 10, changedPixels: 3));

        Assert.Equal(0.03, comparison.Difference, precision: 10);
    }

    [Fact]
    public void Different_sizes_differ_completely()
    {
        ImageComparison comparison = _comparer.Compare(Image("a", 10, 10), Image("b", 10, 11));

        Assert.Equal(1.0, comparison.Difference);
        Assert.Equal(new Size(10, 11), comparison.RightSize);
    }

    [Fact]
    public void Rows_pass_within_threshold_and_fail_beyond_it()
    {
        ParityCase parityCase = Case("same", "changed");
        SideRun canonical = Side("canonical", ("same", Image("c1", 100, 100)), ("changed", Image("c2", 100, 100)));
        SideRun candidate = Side("candidate", ("same", Image("d1", 100, 100, changedPixels: 1)), ("changed", Image("d2", 100, 100, changedPixels: 2)));

        IReadOnlyList<CaptureResult> rows = Build(parityCase, canonical, candidate, threshold: 0.0001);

        Assert.Collection(
            rows,
            same =>
            {
                Assert.True(same.Passed);
                Assert.Equal(ResultReason.WithinThreshold, same.Reason);
                Assert.Equal(0.0001, same.Difference);
            },
            changed =>
            {
                Assert.False(changed.Passed);
                Assert.Equal(ResultReason.VisualDifference, changed.Reason);
                Assert.Equal("rel/d2.png", changed.CandidateCapture);
            });
    }

    [Fact]
    public void Capture_skipped_on_one_side_is_a_missing_capture_row()
    {
        ParityCase parityCase = Case("adept-powers");
        SideRun canonical = Side("canonical", ("adept-powers", Image("c", 5, 5)));
        SideRun candidate = Side("candidate", outcome: OutcomeKind.SkippedOptional);

        CaptureResult row = Assert.Single(Build(parityCase, canonical, candidate, threshold: 0));

        Assert.False(row.Passed);
        Assert.Equal(ResultReason.MissingCandidate, row.Reason);
        Assert.Equal(1.0, row.Difference);
        Assert.Null(row.CandidateCapture);
    }

    [Fact]
    public void Capture_missing_because_of_an_execution_failure_has_no_row()
    {
        ParityCase parityCase = Case("skills");
        SideRun canonical = Side("canonical", ("skills", Image("c", 5, 5)));
        SideRun candidate = Side("candidate", outcome: OutcomeKind.NotRun);

        Assert.Empty(Build(parityCase, canonical, candidate, threshold: 0));
    }

    private IReadOnlyList<CaptureResult> Build(ParityCase parityCase, SideRun canonical, SideRun candidate, double threshold) =>
        new VisualResultBuilder(_comparer).Build(parityCase, canonical, candidate, threshold, path => $"rel/{Path.GetFileName(path)}");

    private static ParityCase Case(params string[] captures) =>
        new("build-test", "test.chum", "test.chum", CharacterMode.Build, captures.Select(name => (ParityAction)new CaptureAction(name)).ToList());

    /// <summary>A side whose listed captures were performed; any other capture has <paramref name="outcome"/>.</summary>
    private static SideRun Side(string side, params (string Name, string Path)[] captures) => Side(side, OutcomeKind.Performed, captures);

    private static SideRun Side(string side, OutcomeKind outcome, params (string Name, string Path)[] captures)
    {
        string[] all = ["same", "changed", "adept-powers", "skills"];
        List<ActionRecord> actions = all.Select((name, index) => new ActionRecord(
            index,
            $"capture:{name}",
            Required: true,
            captures.Any(capture => capture.Name == name) ? OutcomeKind.Performed : outcome,
            null)).ToList();
        return new SideRun(side, actions, captures.ToDictionary(capture => capture.Name, capture => capture.Path), null, TimeSpan.Zero);
    }

    private string Image(string name, int width, int height, int changedPixels = 0)
    {
        string path = Path.Combine(_directory, $"{name}.png");
        using Bitmap bitmap = new(width, height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.White);
        }

        for (int index = 0; index < changedPixels; index++)
        {
            bitmap.SetPixel(index, 0, Color.Black);
        }

        bitmap.Save(path, ImageFormat.Png);
        return path;
    }
}
