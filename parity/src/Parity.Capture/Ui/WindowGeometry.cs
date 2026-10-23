using System.Diagnostics;
using System.Runtime.InteropServices;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Window bounds as the user sees them, and waiting until they stop changing.</summary>
internal sealed class WindowGeometry
{
    public static readonly TimeSpan StabilityTimeout = TimeSpan.FromSeconds(5);

    /// <summary>The DWM frame bounds (falling back to the window rectangle), clipped to the screens.</summary>
    public Rectangle GetVisibleBounds(IntPtr handle)
    {
        if (handle == IntPtr.Zero)
        {
            return Rectangle.Empty;
        }

        if (NativeMethods.DwmGetWindowAttribute(handle, NativeMethods.DwmwaExtendedFrameBounds, out NativeMethods.Rect rect, Marshal.SizeOf<NativeMethods.Rect>()) != 0
            && !NativeMethods.GetWindowRect(handle, out rect))
        {
            return Rectangle.Empty;
        }

        Rectangle bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
        Rectangle? visible = null;
        foreach (Screen screen in Screen.AllScreens)
        {
            Rectangle intersection = Rectangle.Intersect(bounds, screen.Bounds);
            if (intersection.Width > 0 && intersection.Height > 0)
            {
                visible = visible is null ? intersection : Rectangle.Union(visible.Value, intersection);
            }
        }

        return visible ?? bounds;
    }

    /// <summary>
    /// The window rectangle as the window itself measures it, which is the size <c>PrintWindow</c>
    /// renders: physical pixels for a DPI-aware window, logical pixels for a DPI-unaware one.
    /// </summary>
    public Rectangle GetRenderedWindowRectangle(IntPtr handle)
    {
        IntPtr context = NativeMethods.GetWindowDpiAwarenessContext(handle);
        IntPtr previous = context == IntPtr.Zero ? IntPtr.Zero : NativeMethods.SetThreadDpiAwarenessContext(context);
        if (previous == IntPtr.Zero)
        {
            throw new InvalidOperationException($"Could not switch to the DPI awareness of window {handle}.");
        }

        try
        {
            return GetWindowRectangle(handle);
        }
        finally
        {
            NativeMethods.SetThreadDpiAwarenessContext(previous);
        }
    }

    /// <summary>The window rectangle, including the invisible resize borders, in this thread's coordinates.</summary>
    public Rectangle GetWindowRectangle(IntPtr handle) =>
        NativeMethods.GetWindowRect(handle, out NativeMethods.Rect rect)
            ? Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom)
            : throw new InvalidOperationException($"GetWindowRect failed for window {handle}.");

    /// <summary>
    /// Waits until the bounds are non-empty and unchanged for <paramref name="stableFor"/>. The bounds
    /// get <see cref="StabilityTimeout"/> to settle on top of that interval, whatever its length.
    /// </summary>
    public Rectangle WaitForStableBounds(Func<IntPtr> getWindow, TimeSpan stableFor)
    {
        TimeSpan timeout = StabilityTimeout + stableFor;
        Stopwatch timer = Stopwatch.StartNew();
        Stopwatch? stableTimer = null;
        Rectangle previous = Rectangle.Empty;
        while (timer.Elapsed < timeout)
        {
            Rectangle bounds = GetVisibleBounds(getWindow());
            if (bounds.Width <= 0 || bounds.Height <= 0)
            {
                stableTimer = null;
                previous = Rectangle.Empty;
            }
            else if (bounds != previous)
            {
                previous = bounds;
                stableTimer = Stopwatch.StartNew();
            }
            else if (stableTimer is not null && stableTimer.Elapsed >= stableFor)
            {
                return bounds;
            }

            Thread.Sleep(100);
        }

        throw new TimeoutException(
            $"The window bounds did not stay unchanged for {stableFor.TotalMilliseconds:0} ms within {timeout.TotalSeconds:0.#} s (last {previous}).");
    }
}
