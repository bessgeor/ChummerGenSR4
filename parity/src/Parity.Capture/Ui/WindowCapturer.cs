using System.Drawing.Imaging;
using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Renders a window into a bitmap with <c>PrintWindow</c>, after moving focus to a neutral control.</summary>
internal sealed class WindowCapturer(WindowGeometry geometry)
{
    /// <summary>The status bar of an open character form, or <see cref="IntPtr.Zero"/> when there is none.</summary>
    public IntPtr FindStatusBar(IntPtr mainWindow)
    {
        AutomationElement? statusBar = AutomationElement.FromHandle(mainWindow).FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.StatusBar));
        return statusBar is null ? IntPtr.Zero : new IntPtr(statusBar.Current.NativeWindowHandle);
    }

    /// <summary>Focuses the status bar so no focus rectangle depends on earlier input.</summary>
    public void FocusStatusBar(IntPtr mainWindow)
    {
        IntPtr statusBarHandle = FindStatusBar(mainWindow);
        if (statusBarHandle == IntPtr.Zero)
        {
            throw new InvalidOperationException("Could not find the status bar window to normalize focus.");
        }

        uint targetThreadId = NativeMethods.GetWindowThreadProcessId(statusBarHandle, out _);
        uint sourceThreadId = NativeMethods.GetCurrentThreadId();
        bool attached = sourceThreadId != targetThreadId && NativeMethods.AttachThreadInput(sourceThreadId, targetThreadId, true);
        try
        {
            NativeMethods.SetFocus(statusBarHandle);
        }
        finally
        {
            if (attached)
            {
                NativeMethods.AttachThreadInput(sourceThreadId, targetThreadId, false);
            }
        }
    }

    /// <summary>
    /// Renders an activated window and returns the part inside its visible <paramref name="bounds"/>,
    /// without the invisible resize borders or anything off screen. The frame is repainted as active
    /// first: whether it looks active otherwise depends on the activation history, not on the app.
    /// A failed <c>PrintWindow</c> is an error; there is no screen-copy fallback.
    /// </summary>
    public Bitmap Capture(IntPtr handle, Rectangle bounds)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0)
        {
            throw new InvalidOperationException($"Cannot capture the empty rectangle {bounds}.");
        }

        NativeMethods.SendMessage(handle, NativeMethods.WmNcActivate, new IntPtr(1), IntPtr.Zero);
        Rectangle rendered = geometry.GetRenderedWindowRectangle(handle);
        Rectangle region = CaptureRegion.Map(geometry.GetWindowRectangle(handle), rendered.Size, bounds);
        using Bitmap window = new(rendered.Width, rendered.Height, PixelFormat.Format32bppArgb);
        using (Graphics graphics = Graphics.FromImage(window))
        {
            IntPtr hdc = graphics.GetHdc();
            bool printed;
            try
            {
                printed = NativeMethods.PrintWindow(handle, hdc, NativeMethods.PwRenderFullContent);
            }
            finally
            {
                graphics.ReleaseHdc(hdc);
            }

            if (!printed)
            {
                throw new InvalidOperationException($"PrintWindow failed for window {handle}.");
            }
        }

        return window.Clone(region, PixelFormat.Format32bppArgb);
    }
}
