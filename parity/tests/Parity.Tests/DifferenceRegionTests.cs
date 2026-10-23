using Parity.Compare.Detection;
using Parity.Imaging;
using Parity.Tests.Fakes;

namespace Parity.Tests;

public sealed class DifferenceRegionTests
{
    private readonly DiscrepancyLocator _locator = new(new RegionFinder(), new CropExpander());

    [Fact]
    public void A_single_changed_pixel_is_a_region()
    {
        using Bitmap canonical = CaptureRunFolder.Image(100, 50);
        using Bitmap candidate = CaptureRunFolder.Image(100, 50);
        candidate.SetPixel(40, 20, Color.FromArgb(250, 250, 250));

        ChangeRegion region = Assert.Single(new RegionFinder().Find(Difference(canonical, candidate)));

        Assert.Equal(new Rectangle(40, 20, 1, 1), region.Core);
        Assert.Equal(1, region.DifferingPixels);
    }

    [Fact]
    public void A_change_between_two_dark_colors_is_found()
    {
        using Bitmap canonical = CaptureRunFolder.Image(200, 40, graphics => DrawText(graphics, "Body 4", Brushes.Black, 10));
        using Bitmap candidate = CaptureRunFolder.Image(200, 40, graphics => DrawText(graphics, "Body 4", new SolidBrush(Color.FromArgb(128, 0, 0)), 10));
        PixelDifference difference = Difference(canonical, candidate);

        IReadOnlyList<LocatedChange> changes = _locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), difference);

        Assert.NotEmpty(changes);
        Assert.Equal(difference.Count, changes.Sum(change => change.DifferingPixels));
    }

    [Fact]
    public void Distant_changes_stay_apart_and_near_ones_merge()
    {
        using Bitmap canonical = CaptureRunFolder.Image(400, 300);
        using Bitmap candidate = CaptureRunFolder.Image(400, 300);
        candidate.SetPixel(10, 10, Color.Black);
        candidate.SetPixel(10 + Regions.MergeGap, 10, Color.Black);
        candidate.SetPixel(300, 250, Color.Black);

        IReadOnlyList<ChangeRegion> regions = new RegionFinder().Find(Difference(canonical, candidate));

        Assert.Collection(
            regions,
            near => Assert.Equal((new Rectangle(10, 10, Regions.MergeGap + 1, 1), 2L), (near.Core, near.DifferingPixels)),
            far => Assert.Equal((new Rectangle(300, 250, 1, 1), 1L), (far.Core, far.DifferingPixels)));
    }

    [Fact]
    public void Pixel_counts_add_up_and_crops_contain_their_cores()
    {
        using Bitmap canonical = CaptureRunFolder.Image(640, 340, graphics =>
        {
            DrawText(graphics, "Metatype 40 BP", Brushes.Black, 20);
            DrawText(graphics, "Contacts 2 BP", Brushes.Black, 200);
        });
        using Bitmap candidate = CaptureRunFolder.Image(640, 340, graphics =>
        {
            DrawText(graphics, "Metatype 45 BP", Brushes.Black, 20);
            DrawText(graphics, "Contacts 3 BP", Brushes.DarkBlue, 200);
        });
        candidate.SetPixel(600, 330, Color.FromArgb(254, 255, 255));
        PixelDifference difference = Difference(canonical, candidate);

        IReadOnlyList<LocatedChange> changes = _locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), difference);

        Assert.True(changes.Count >= 3);
        Assert.Equal(difference.Count, changes.Sum(change => change.DifferingPixels));
        Assert.All(changes, change => Assert.True(change.Crop.Contains(change.Core)));
        Assert.Equal(changes.OrderBy(change => change.Core.Y).ThenBy(change => change.Core.X), changes);
    }

    [Fact]
    public void A_changed_value_is_cropped_with_its_label()
    {
        using Bitmap canonical = CaptureRunFolder.Image(400, 60, graphics => DrawText(graphics, "Special Attributes      40 BP", Brushes.Black, 20));
        using Bitmap candidate = CaptureRunFolder.Image(400, 60, graphics => DrawText(graphics, "Special Attributes      45 BP", Brushes.Black, 20));

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        Assert.True(change.Core.X > 60, $"core {change.Core}");
        Assert.True(change.Crop.X < 20, $"crop {change.Crop} does not reach the label");
    }

    [Fact]
    public void A_changed_value_does_not_reach_text_across_a_wide_blank_gap()
    {
        using Bitmap canonical = CaptureRunFolder.Image(400, 60, graphics =>
        {
            DrawText(graphics, "Label", Brushes.Black, 20);
            DrawText(graphics, "40", Brushes.Black, 20, x: 200);
        });
        using Bitmap candidate = CaptureRunFolder.Image(400, 60, graphics =>
        {
            DrawText(graphics, "Label", Brushes.Black, 20);
            DrawText(graphics, "45", Brushes.Black, 20, x: 200);
        });

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        Assert.True(change.Crop.X > 150, $"crop {change.Crop} reaches text more than 120 px to the left");
    }

    [Fact]
    public void A_line_taller_than_the_search_band_is_cropped_whole()
    {
        using Font font = new("Microsoft Sans Serif", 20f);
        using Bitmap canonical = CaptureRunFolder.Image(300, 80, graphics => graphics.DrawString("Body 4", font, Brushes.Black, 10, 20));
        using Bitmap candidate = CaptureRunFolder.Image(300, 80, graphics => graphics.DrawString("Body 5", font, Brushes.Black, 10, 20));
        Rectangle text = InkBounds(canonical);

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        Assert.True(text.Height > 20, $"text {text}");
        Assert.True(change.Crop.Top <= text.Top && change.Crop.Bottom >= text.Bottom, $"crop {change.Crop} cuts the text {text}");
    }

    [Fact]
    public void A_line_does_not_follow_a_long_vertical_edge()
    {
        using Bitmap canonical = CaptureRunFolder.Image(300, 200, graphics =>
        {
            graphics.DrawLine(Pens.Black, 8, 0, 8, 199);
            DrawText(graphics, "Body 4", Brushes.Black, 100);
        });
        using Bitmap candidate = CaptureRunFolder.Image(300, 200, graphics =>
        {
            graphics.DrawLine(Pens.Black, 8, 0, 8, 199);
            DrawText(graphics, "Body 5", Brushes.Black, 100);
        });

        using Bitmap textOnly = CaptureRunFolder.Image(300, 200, graphics => DrawText(graphics, "Body 4", Brushes.Black, 100));
        Rectangle text = InkBounds(textOnly);

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        Assert.True(change.Crop.X <= 8, $"crop {change.Crop} does not reach the edge");
        Assert.True(change.Crop.Top <= text.Top && change.Crop.Bottom >= text.Bottom, $"crop {change.Crop} cuts the text {text}");
        Assert.True(change.Crop.Height < 24, $"crop {change.Crop} follows the edge");
    }

    [Fact]
    public void A_value_in_a_label_value_block_is_cropped_with_the_block_wherever_it_sits()
    {
        string[] labels = ["Body", "Agility", "Reaction"];
        using Bitmap canonical = CaptureRunFolder.Image(1280, 100, graphics => DrawBlock(graphics, labels, ["4", "3", "2"]));
        using Bitmap candidate = CaptureRunFolder.Image(1280, 100, graphics => DrawBlock(graphics, labels, ["4", "5", "2"]));
        Rectangle block = InkBounds(canonical);

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        Assert.True(change.Crop.Top <= block.Top && change.Crop.Bottom >= block.Bottom, $"crop {change.Crop} does not show the block {block}");

        static void DrawBlock(Graphics graphics, string[] labels, string[] values)
        {
            for (int row = 0; row < labels.Length; row++)
            {
                DrawText(graphics, labels[row], Brushes.Black, 20 + (row * 18), x: 1000);
                DrawText(graphics, values[row], Brushes.Black, 20 + (row * 18), x: 1100);
            }
        }
    }

    [Theory]
    [InlineData(16)]
    [InlineData(17)]
    [InlineData(18)]
    [InlineData(19)]
    [InlineData(20)]
    [InlineData(21)]
    [InlineData(22)]
    [InlineData(23)]
    public void A_block_crop_does_not_cut_a_row(int spacing)
    {
        string[] values = Enumerable.Range(0, 16).Select(row => $"{row}").ToArray();
        using Bitmap canonical = CaptureRunFolder.Image(400, 400, graphics => DrawRows(graphics, values));
        using Bitmap candidate = CaptureRunFolder.Image(400, 400, graphics => DrawRows(graphics, ["X", .. values[1..]]));

        LocatedChange change = Assert.Single(_locator.Locate(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate), Difference(canonical, candidate)));

        for (int row = 0; row < values.Length; row++)
        {
            using Bitmap single = CaptureRunFolder.Image(400, 400, graphics => DrawText(graphics, $"Label {row}   {values[row]}", Brushes.Black, 10 + (row * spacing), x: 20));
            Rectangle ink = InkBounds(single);
            bool cutAtTop = change.Crop.Top > ink.Top && change.Crop.Top < ink.Bottom;
            bool cutAtBottom = change.Crop.Bottom > ink.Top && change.Crop.Bottom < ink.Bottom;
            Assert.False(cutAtTop || cutAtBottom, $"crop {change.Crop} cuts row {row} at {ink}");
        }

        void DrawRows(Graphics graphics, string[] rowValues)
        {
            for (int row = 0; row < rowValues.Length; row++)
            {
                DrawText(graphics, $"Label {row}   {rowValues[row]}", Brushes.Black, 10 + (row * spacing), x: 20);
            }
        }
    }

    [Fact]
    public void Regions_that_grow_near_another_merge_with_it()
    {
        // The third is near neither of the first two, only near the corner of their union.
        Rectangle[] boxes = [new(200, 0, 1, 1), new(30, -14, 1, 1), new(0, 0, 1, 1), new(15, 15, 1, 1)];

        List<Rectangle> merged = Regions.Merge(boxes, box => box, Rectangle.Union, gap: 18);

        Assert.Equal([new Rectangle(200, 0, 1, 1), Rectangle.FromLTRB(0, -14, 31, 16)], merged);
    }

    [Fact]
    public void Many_separate_regions_stay_apart()
    {
        Rectangle[] boxes = Enumerable.Range(0, 20_000).Select(index => new Rectangle(index % 200 * 40, index / 200 * 40, 2, 2)).ToArray();

        List<Rectangle> merged = Regions.Merge(boxes, box => box, Rectangle.Union, gap: 18);

        Assert.Equal(boxes, merged);
    }

    private static PixelDifference Difference(Bitmap canonical, Bitmap candidate) =>
        PixelDifference.Of(ArgbImage.FromBitmap(canonical), ArgbImage.FromBitmap(candidate));

    private static Rectangle InkBounds(Bitmap image)
    {
        ArgbImage pixels = ArgbImage.FromBitmap(image);
        int left = pixels.Width, top = pixels.Height, right = -1, bottom = -1;
        for (int y = 0; y < pixels.Height; y++)
        {
            for (int x = 0; x < pixels.Width; x++)
            {
                if (InkMap.LooksLikeInk(pixels.Pixels[(y * pixels.Width) + x]))
                {
                    (left, top, right, bottom) = (Math.Min(left, x), Math.Min(top, y), Math.Max(right, x), Math.Max(bottom, y));
                }
            }
        }

        return Rectangle.FromLTRB(left, top, right + 1, bottom + 1);
    }

    private static void DrawText(Graphics graphics, string text, Brush brush, int y, int x = 10)
    {
        using Font font = new("Microsoft Sans Serif", 8.25f);
        graphics.DrawString(text, font, brush, x, y);
    }
}
