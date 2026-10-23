using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Parity.Imaging;

/// <summary>
/// A decoded image as 32-bit ARGB pixels (<c>0xAARRGGBB</c>), row by row. Every image is converted to
/// the same format on load, so two images can be compared pixel by pixel whatever their file format.
/// </summary>
public sealed class ArgbImage
{
    private readonly int[] _pixels;

    private ArgbImage(int width, int height, int[] pixels)
    {
        Width = width;
        Height = height;
        _pixels = pixels;
    }

    public int Width { get; }

    public int Height { get; }

    public Size Size => new(Width, Height);

    public ReadOnlySpan<int> Pixels => _pixels;

    public int this[int x, int y] => _pixels[(y * Width) + x];

    public static ArgbImage Load(string path)
    {
        using Bitmap bitmap = new(path);
        return FromBitmap(bitmap);
    }

    public static ArgbImage FromBitmap(Bitmap bitmap)
    {
        Rectangle area = new(Point.Empty, bitmap.Size);
        BitmapData data = bitmap.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int[] pixels = new int[bitmap.Width * bitmap.Height];
            for (int y = 0; y < bitmap.Height; y++)
            {
                Marshal.Copy(IntPtr.Add(data.Scan0, y * data.Stride), pixels, y * bitmap.Width, bitmap.Width);
            }

            return new ArgbImage(bitmap.Width, bitmap.Height, pixels);
        }
        finally
        {
            bitmap.UnlockBits(data);
        }
    }

    /// <summary>The pixels inside <paramref name="region"/>, which must lie within the image.</summary>
    public ArgbImage Crop(Rectangle region)
    {
        if (region.Width <= 0 || region.Height <= 0 || !new Rectangle(Point.Empty, Size).Contains(region))
        {
            throw new ArgumentOutOfRangeException(nameof(region), region, $"The region is not inside the {Width}×{Height} image.");
        }

        int[] pixels = new int[region.Width * region.Height];
        for (int y = 0; y < region.Height; y++)
        {
            Array.Copy(_pixels, ((region.Y + y) * Width) + region.X, pixels, y * region.Width, region.Width);
        }

        return new ArgbImage(region.Width, region.Height, pixels);
    }

    public Bitmap ToBitmap()
    {
        Bitmap bitmap = new(Width, Height, PixelFormat.Format32bppArgb);
        BitmapData data = bitmap.LockBits(new Rectangle(Point.Empty, Size), ImageLockMode.WriteOnly, PixelFormat.Format32bppArgb);
        try
        {
            for (int y = 0; y < Height; y++)
            {
                Marshal.Copy(_pixels, y * Width, IntPtr.Add(data.Scan0, y * data.Stride), Width);
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }

        return bitmap;
    }

    public void SavePng(string path)
    {
        using Bitmap bitmap = ToBitmap();
        bitmap.Save(path, ImageFormat.Png);
    }
}
