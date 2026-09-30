using System.ComponentModel;

namespace Parity.Capture.Interop;

/// <summary>Makes this process per-monitor DPI aware, so window coordinates and captures are physical pixels.</summary>
internal static class DpiAwareness
{
    public static void Enable()
    {
        int result = NativeMethods.SetProcessDpiAwareness(NativeMethods.ProcessPerMonitorDpiAware);
        // E_ACCESSDENIED means the awareness was already set for this process, which is what we need.
        if (result != 0 && result != NativeMethods.EAccessDenied)
        {
            throw new Win32Exception(result, $"SetProcessDpiAwareness failed with 0x{result:X8}.");
        }
    }
}
