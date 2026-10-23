using System.Drawing.Imaging;
using Parity.Imaging;

namespace Parity.Tests;

public sealed class PixelDifferenceTests : IDisposable
{
    private readonly string _directory = Directory.CreateTempSubdirectory("parity-imaging-").FullName;

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Same_pixels_in_different_file_formats_do_not_differ()
    {
        ArgbImage rgb = ArgbImage.Load(Save("rgb", PixelFormat.Format24bppRgb));
        ArgbImage argb = ArgbImage.Load(Save("argb", PixelFormat.Format32bppArgb));

        Assert.Equal(0, PixelDifference.Of(rgb, argb).Count);
    }

    [Fact]
    public void Any_channel_change_is_a_difference()
    {
        using Bitmap left = new(3, 1, PixelFormat.Format32bppArgb);
        using Bitmap right = new(3, 1, PixelFormat.Format32bppArgb);
        left.SetPixel(1, 0, Color.FromArgb(255, 10, 10, 10));
        right.SetPixel(1, 0, Color.FromArgb(255, 10, 10, 11));

        PixelDifference difference = PixelDifference.Of(ArgbImage.FromBitmap(left), ArgbImage.FromBitmap(right));

        Assert.Equal(1, difference.Count);
        Assert.True(difference[1, 0]);
        Assert.False(difference[0, 0]);
        Assert.Equal(1 / 3.0, difference.Ratio, precision: 10);
    }

    [Fact]
    public void Images_of_different_sizes_have_no_pixel_difference()
    {
        using Bitmap left = new(2, 2);
        using Bitmap right = new(2, 3);

        Assert.Throws<ArgumentException>(() => PixelDifference.Of(ArgbImage.FromBitmap(left), ArgbImage.FromBitmap(right)));
    }

    [Fact]
    public void Crop_keeps_the_region_pixels_and_rejects_regions_outside()
    {
        using Bitmap bitmap = new(4, 3, PixelFormat.Format32bppArgb);
        bitmap.SetPixel(2, 1, Color.Red);
        ArgbImage image = ArgbImage.FromBitmap(bitmap);

        ArgbImage crop = image.Crop(new Rectangle(1, 1, 2, 2));

        Assert.Equal(new Size(2, 2), crop.Size);
        Assert.Equal(Color.Red.ToArgb(), crop[1, 0]);
        Assert.Throws<ArgumentOutOfRangeException>(() => image.Crop(new Rectangle(3, 0, 2, 1)));
    }

    private string Save(string name, PixelFormat format)
    {
        string path = Path.Combine(_directory, $"{name}.png");
        using Bitmap bitmap = new(5, 4, format);
        using (Graphics graphics = Graphics.FromImage(bitmap))
        {
            graphics.Clear(Color.FromArgb(240, 240, 240));
        }

        bitmap.SetPixel(2, 2, Color.FromArgb(30, 60, 90));
        bitmap.Save(path, ImageFormat.Png);
        return path;
    }
}
