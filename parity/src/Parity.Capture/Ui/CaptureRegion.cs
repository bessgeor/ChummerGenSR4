namespace Parity.Capture.Ui;

/// <summary>
/// Locates the visible part of a window inside the bitmap <c>PrintWindow</c> renders. That bitmap
/// starts at the window rectangle's origin, so it includes the invisible resize borders, and it has
/// the size the window itself measures, which is smaller than the physical one for a DPI-unaware window.
/// </summary>
internal static class CaptureRegion
{
    /// <param name="window">The window rectangle in physical pixels.</param>
    /// <param name="rendered">The size of the rendered bitmap.</param>
    /// <param name="visible">The visible bounds in physical pixels.</param>
    public static Rectangle Map(Rectangle window, Size rendered, Rectangle visible)
    {
        if (window.Width <= 0 || window.Height <= 0 || rendered.Width <= 0 || rendered.Height <= 0)
        {
            throw new InvalidOperationException($"Cannot map a capture for the window {window} rendered at {rendered}.");
        }

        if (!window.Contains(visible))
        {
            throw new InvalidOperationException($"The visible bounds {visible} are not inside the window rectangle {window}.");
        }

        double scaleX = rendered.Width / (double)window.Width;
        double scaleY = rendered.Height / (double)window.Height;
        Rectangle region = Rectangle.FromLTRB(
            (int)Math.Round((visible.Left - window.Left) * scaleX),
            (int)Math.Round((visible.Top - window.Top) * scaleY),
            (int)Math.Round((visible.Right - window.Left) * scaleX),
            (int)Math.Round((visible.Bottom - window.Top) * scaleY));
        if (region.Width <= 0 || region.Height <= 0)
        {
            throw new InvalidOperationException($"The visible bounds {visible} map to the empty region {region}.");
        }

        return region;
    }
}
