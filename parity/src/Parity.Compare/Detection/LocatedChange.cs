namespace Parity.Compare.Detection;

/// <summary>A discrepancy's location: its change core, its review crop and its differing-pixel count.</summary>
internal sealed record LocatedChange(Rectangle Core, Rectangle Crop, long DifferingPixels)
{
    public static LocatedChange Combine(LocatedChange a, LocatedChange b) =>
        new(Rectangle.Union(a.Core, b.Core), Rectangle.Union(a.Crop, b.Crop), a.DifferingPixels + b.DifferingPixels);
}
