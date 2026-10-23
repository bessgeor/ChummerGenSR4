using Parity.Imaging;

namespace Parity.Compare.Detection;

/// <summary>
/// Locates the discrepancies of one capture pair: change regions from the raw difference, each with a
/// review crop; discrepancies whose crops touch are merged, so no context is shown twice. Discrepancies
/// are ordered top to bottom, then left to right, by their cores.
/// </summary>
internal sealed class DiscrepancyLocator(RegionFinder finder, CropExpander expander)
{
    public IReadOnlyList<LocatedChange> Locate(ArgbImage canonical, ArgbImage candidate, PixelDifference difference)
    {
        InkMap ink = new(canonical, candidate);
        IEnumerable<LocatedChange> changes = finder.Find(difference)
            .Select(region => new LocatedChange(region.Core, expander.Expand(region.Core, ink), region.DifferingPixels));
        return Regions.Merge(changes, change => change.Crop, LocatedChange.Combine, Regions.MergeGap)
            .OrderBy(change => change.Core.Y)
            .ThenBy(change => change.Core.X)
            .ToList();
    }
}
