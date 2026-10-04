using System.Text;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>The window graph of the desktop: <c>IsWindowEnabled</c>, and the owned windows in the z-order <c>EnumWindows</c> gives.</summary>
internal sealed class Win32WindowGraph : IWindowGraph
{
    public bool IsEnabled(IntPtr window) => NativeMethods.IsWindowEnabled(window);

    public IReadOnlyList<IntPtr> OwnedWindows(IntPtr owner)
    {
        List<IntPtr> owned = [];
        NativeMethods.EnumWindows((window, _) =>
        {
            if (NativeMethods.IsWindowVisible(window) && NativeMethods.GetWindow(window, NativeMethods.GwOwner) == owner && !IsTooltip(window))
            {
                owned.Add(window);
            }

            return true;
        }, IntPtr.Zero);
        return owned;
    }

    private static bool IsTooltip(IntPtr window)
    {
        StringBuilder className = new(128);
        NativeMethods.GetClassName(window, className, className.Capacity);
        return IsTooltipClass(className.ToString());
    }

    /// <summary>The native tooltips class and the one WinForms registers for its tool tips, which has a prefix and a suffix.</summary>
    internal static bool IsTooltipClass(string className) => className.Contains("tooltips_class32", StringComparison.Ordinal);
}
