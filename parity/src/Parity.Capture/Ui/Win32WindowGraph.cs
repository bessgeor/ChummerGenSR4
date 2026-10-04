using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>The window graph of the desktop, through <c>IsWindowEnabled</c> and <c>GetWindow(GW_ENABLEDPOPUP)</c>.</summary>
internal sealed class Win32WindowGraph : IWindowGraph
{
    public bool IsEnabled(IntPtr window) => NativeMethods.IsWindowEnabled(window);

    public IntPtr EnabledPopup(IntPtr window) => NativeMethods.GetWindow(window, NativeMethods.GwEnabledPopup);
}
