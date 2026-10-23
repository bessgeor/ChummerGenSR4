using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Finds, selects and checks tab items of the visible <c>SysTabControl32</c> controls through MSAA.</summary>
internal sealed class TabNavigator
{
    /// <summary>The first tab item with this exact name, scanning tab controls top to bottom, left to right.</summary>
    public AccessibleTab Find(IntPtr mainWindow, string name)
    {
        List<(IntPtr Handle, Rectangle Bounds)> controls = VisibleTabControls(mainWindow);
        foreach ((IntPtr handle, _) in controls)
        {
            IAccessible? accessible = AccessibleOf(handle);
            if (accessible is null)
            {
                continue;
            }

            for (int childId = 1; childId <= accessible.AccChildCount; childId++)
            {
                if (string.Equals(ChildName(accessible, childId), name, StringComparison.CurrentCulture))
                {
                    return new AccessibleTab(accessible, childId, handle);
                }
            }
        }

        throw new TabNotFoundException($"No tab named '{name}'. Visible tab controls: {Describe(controls)}");
    }

    public void Select(AccessibleTab tab) => tab.Accessible.AccDoDefaultAction(tab.ChildId);

    /// <summary>Polls the selected state; returns false when it is not selected within <paramref name="timeout"/>.</summary>
    public bool WaitUntilSelected(AccessibleTab tab, TimeSpan timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        do
        {
            if (IsSelected(tab))
            {
                return true;
            }

            Thread.Sleep(25);
        }
        while (timer.Elapsed < timeout);

        return false;
    }

    public string DescribeSelection(AccessibleTab tab)
    {
        int state = Convert.ToInt32(tab.Accessible.GetAccState(tab.ChildId), System.Globalization.CultureInfo.InvariantCulture);
        int current = NativeMethods.SendMessage(tab.ControlHandle, NativeMethods.TcmGetCurSel, IntPtr.Zero, IntPtr.Zero).ToInt32();
        return $"MSAA state={state}, native current index={current}, expected index={tab.ChildId - 1}, " +
               $"control={tab.ControlHandle}, foreground={NativeMethods.GetForegroundWindow()}";
    }

    /// <summary>
    /// Selected when MSAA reports the selected state, or when the control's native current index is this
    /// item: some builds expose the item through MSAA but omit the state bit after the default action.
    /// </summary>
    private static bool IsSelected(AccessibleTab tab)
    {
        int state = Convert.ToInt32(tab.Accessible.GetAccState(tab.ChildId), System.Globalization.CultureInfo.InvariantCulture);
        if ((state & NativeMethods.StateSystemSelected) == NativeMethods.StateSystemSelected)
        {
            return true;
        }

        int current = NativeMethods.SendMessage(tab.ControlHandle, NativeMethods.TcmGetCurSel, IntPtr.Zero, IntPtr.Zero).ToInt32();
        return current == tab.ChildId - 1;
    }

    private static IAccessible? AccessibleOf(IntPtr handle)
    {
        Guid iid = NativeMethods.IAccessibleGuid;
        return NativeMethods.AccessibleObjectFromWindow(handle, NativeMethods.ObjidClient, ref iid, out object accessible) == 0
            ? accessible as IAccessible
            : null;
    }

    /// <summary>
    /// An item whose name MSAA cannot read has no name, so it is not a match. Tab controls count
    /// children they reject by id (E_INVALIDARG, surfaced as <see cref="ArgumentException"/>).
    /// </summary>
    private static string? ChildName(IAccessible accessible, int childId)
    {
        try
        {
            return accessible.GetAccName(childId);
        }
        catch (Exception error) when (error is COMException or ArgumentException)
        {
            return null;
        }
    }

    private static List<(IntPtr Handle, Rectangle Bounds)> VisibleTabControls(IntPtr mainWindow)
    {
        List<(IntPtr Handle, Rectangle Bounds)> controls = [];
        NativeMethods.EnumChildWindows(mainWindow, (handle, _) =>
        {
            if (!NativeMethods.IsWindowVisible(handle) || !ClassName(handle).Contains("SysTabControl32", StringComparison.Ordinal)
                || !NativeMethods.GetWindowRect(handle, out NativeMethods.Rect rect))
            {
                return true;
            }

            Rectangle bounds = Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            int count = NativeMethods.SendMessage(handle, NativeMethods.TcmGetItemCount, IntPtr.Zero, IntPtr.Zero).ToInt32();
            if (bounds.Width > 10 && bounds.Height > 10 && count > 1)
            {
                controls.Add((handle, bounds));
            }

            return true;
        }, IntPtr.Zero);
        return controls.OrderBy(control => control.Bounds.Top).ThenBy(control => control.Bounds.Left).ToList();
    }

    private static string Describe(List<(IntPtr Handle, Rectangle Bounds)> controls)
    {
        if (controls.Count == 0)
        {
            return "<none>";
        }

        return string.Join(" | ", controls.Select(control =>
        {
            IAccessible? accessible = AccessibleOf(control.Handle);
            IEnumerable<string?> names = accessible is null
                ? []
                : Enumerable.Range(1, accessible.AccChildCount).Select(childId => ChildName(accessible, childId));
            return $"HWND={control.Handle} rect={control.Bounds} names=[{string.Join(", ", names)}]";
        }));
    }

    private static string ClassName(IntPtr handle)
    {
        StringBuilder text = new(256);
        NativeMethods.GetClassName(handle, text, text.Capacity);
        return text.ToString();
    }
}
