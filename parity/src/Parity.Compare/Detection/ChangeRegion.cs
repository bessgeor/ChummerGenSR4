namespace Parity.Compare.Detection;

/// <summary>A change core (the bounding box of differing pixels) and the number of those pixels.</summary>
internal sealed record ChangeRegion(Rectangle Core, long DifferingPixels)
{
    public static ChangeRegion Combine(ChangeRegion a, ChangeRegion b) =>
        new(Rectangle.Union(a.Core, b.Core), a.DifferingPixels + b.DifferingPixels);
}
