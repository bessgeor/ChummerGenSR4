using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// Keeps the mouse pointer in the middle of the main window's title bar, where nothing reacts to it,
/// so no hover effect in a capture depends on where the pointer was left. A pointer that leaves that
/// spot during a side fails the next capture instead of changing its pixels.
/// </summary>
internal sealed class PointerParker
{
    private const int CaptionHeightMetric = 4;

    /// <summary>The middle of the title bar of a window whose visible bounds are <paramref name="windowBounds"/>.</summary>
    public static Point SpotFor(Rectangle windowBounds, int captionHeight) =>
        new(windowBounds.Left + windowBounds.Width / 2, windowBounds.Top + captionHeight / 2);

    public Point Park(Rectangle windowBounds)
    {
        Point spot = SpotFor(windowBounds, NativeMethods.GetSystemMetricsForDpi(CaptionHeightMetric, NativeMethods.GetDpiForSystem()));
        if (!NativeMethods.SetCursorPos(spot.X, spot.Y))
        {
            throw new PointerException($"the pointer could not be moved to {spot}.");
        }

        Point current = Current();
        if (current != spot)
        {
            throw new PointerException($"the pointer is at {current} after moving it to {spot}.");
        }

        return spot;
    }

    public void EnsureAt(Point spot)
    {
        Point current = Current();
        if (current != spot)
        {
            throw new PointerException($"the pointer moved from {spot} to {current} during the side; leave the mouse alone during a run.");
        }
    }

    private static Point Current() =>
        NativeMethods.GetCursorPos(out NativeMethods.PointStruct point)
            ? new Point(point.X, point.Y)
            : throw new PointerException("the pointer position could not be read.");
}
