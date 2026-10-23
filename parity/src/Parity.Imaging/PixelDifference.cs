namespace Parity.Imaging;

/// <summary>
/// The raw difference of two images of the same size: a pixel differs when its 32-bit ARGB value
/// differs at all (tolerance 0). This is the single definition used by the capture gate and the comparer.
/// </summary>
public sealed class PixelDifference
{
    private readonly bool[] _mask;

    private PixelDifference(int width, int height, bool[] mask, long count)
    {
        Width = width;
        Height = height;
        _mask = mask;
        Count = count;
    }

    public int Width { get; }

    public int Height { get; }

    /// <summary>The number of differing pixels.</summary>
    public long Count { get; }

    /// <summary>The share of differing pixels.</summary>
    public double Ratio => Count / (double)((long)Width * Height);

    public bool this[int x, int y] => _mask[(y * Width) + x];

    public static PixelDifference Of(ArgbImage left, ArgbImage right)
    {
        if (left.Size != right.Size)
        {
            throw new ArgumentException($"Images of different sizes have no pixel difference: {left.Width}×{left.Height} and {right.Width}×{right.Height}.");
        }

        ReadOnlySpan<int> leftPixels = left.Pixels;
        ReadOnlySpan<int> rightPixels = right.Pixels;
        bool[] mask = new bool[leftPixels.Length];
        long count = 0;
        for (int index = 0; index < leftPixels.Length; index++)
        {
            if (leftPixels[index] != rightPixels[index])
            {
                mask[index] = true;
                count++;
            }
        }

        return new PixelDifference(left.Width, left.Height, mask, count);
    }
}
