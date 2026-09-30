using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Renders a window into a bitmap with <c>PrintWindow</c>, after moving focus to a neutral control.</summary>
internal sealed class WindowCapturer
{
    /// <summary>Focuses the status bar so no focus rectangle depends on earlier input.</summary>
    public void FocusStatusBar(IntPtr mainWindow)
    {
        AutomationElement? statusBar = AutomationElement.FromHandle(mainWindow).FindFirst(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.StatusBar));
        if (statusBar is null || statusBar.Current.NativeWindowHandle == 0)
        {
            throw new InvalidOperationException("Could not find the status bar window to normalize focus.");
        }

        IntPtr statusBarHandle = new(statusBar.Current.NativeWindowHandle);
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

    /// <summary>A failed <c>PrintWindow</c> is an error; there is no screen-copy fallback.</summary>
    public Bitmap Capture(IntPtr handle, Rectangle bounds)
    {
        if (bounds.Width <= 0 || bounds.Height <= 0)
        {
            throw new InvalidOperationException($"Cannot capture the empty rectangle {bounds}.");
        }

        Bitmap bitmap = new(bounds.Width, bounds.Height);
        try
        {
            using Graphics graphics = Graphics.FromImage(bitmap);
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

            return bitmap;
        }
        catch
        {
            bitmap.Dispose();
            throw;
        }
    }
}
