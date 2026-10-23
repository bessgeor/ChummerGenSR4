using Parity.Imaging;

namespace Parity.Compare.Detection;

/// <summary>
/// Pixels that look like UI ink (text, lines, icons) on either side. Used only to shape review crops;
/// it never decides whether a difference exists.
/// </summary>
internal sealed class InkMap
{
    private readonly bool[] _ink;

    public InkMap(ArgbImage canonical, ArgbImage candidate)
    {
        Width = canonical.Width;
        Height = canonical.Height;
        ReadOnlySpan<int> left = canonical.Pixels;
        ReadOnlySpan<int> right = candidate.Pixels;
        _ink = new bool[left.Length];
        for (int index = 0; index < left.Length; index++)
        {
            _ink[index] = LooksLikeInk(left[index]) || LooksLikeInk(right[index]);
        }
    }

    public int Width { get; }

    public int Height { get; }

    public Size Size => new(Width, Height);

    public bool this[int x, int y] => _ink[(y * Width) + x];

    /// <summary>Darker than the light control backgrounds, or a noticeably colored light pixel.</summary>
    public static bool LooksLikeInk(int argb)
    {
        int red = (argb >> 16) & 0xFF;
        int green = (argb >> 8) & 0xFF;
        int blue = argb & 0xFF;
        int contrast = Math.Max(red, Math.Max(green, blue)) - Math.Min(red, Math.Min(green, blue));
        int brightness = (red + green + blue) / 3;
        return brightness < 245 && (brightness < 220 || contrast > 12);
    }
}
