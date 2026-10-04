using System.Diagnostics;
using System.Text;
using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Finds and operates controls through UI Automation, and shows context menus with the context menu key.</summary>
internal sealed class UiaControlAccess(ControlFinder finder, KeyboardInput keyboard) : IControlAccess
{
    public static readonly TimeSpan MenuTimeout = TimeSpan.FromSeconds(5);

    public IValueBox FindValueBox(Func<IntPtr> window, string control)
    {
        AutomationElement element = finder.Find(window, control);
        AutomationElement edit = EditElementOf(element);
        if (!edit.TryGetCurrentPattern(ValuePattern.Pattern, out object? pattern) || ((ValuePattern)pattern).Current.IsReadOnly)
        {
            throw new InvalidOperationException($"'{control}' has no editable value.");
        }

        return new UiaValueBox(element, edit, (ValuePattern)pattern, keyboard, control);
    }

    public Action? FindPress(Func<IntPtr> window, string control)
    {
        AutomationElement element = finder.Find(window, control);
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object? invoke))
        {
            return ((InvokePattern)invoke).Invoke;
        }

        return element.TryGetCurrentPattern(TogglePattern.Pattern, out object? toggle) ? ((TogglePattern)toggle).Toggle : null;
    }

    public ISelectableItem FindItem(Func<IntPtr> window, string control, string item)
    {
        AutomationElement element = finder.Find(window, control);
        foreach (AutomationElement candidate in element.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, item)))
        {
            if (candidate.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? pattern))
            {
                return new UiaSelectableItem((SelectionItemPattern)pattern);
            }
        }

        throw new InvalidOperationException($"'{control}' has no selectable item '{item}'.");
    }

    public IContextMenu OpenContextMenu(ActionContext context, string control)
    {
        AutomationElement element = finder.Find(context.ActiveWindow, control);
        HashSet<IntPtr> before = [.. TopLevelWindows(context.ProcessId)];
        element.SetFocus();
        keyboard.Press(NativeMethods.VkApps);
        return new UiaContextMenu(WaitForMenu(context, control, before), keyboard);
    }

    /// <summary>
    /// The element a typed value goes to: the control itself when it is an edit box, else its first child window that
    /// is an edit box. A numeric up-down shows only its buttons in the control view; its edit box is a child window all
    /// the same.
    /// </summary>
    private static AutomationElement EditElementOf(AutomationElement element) =>
        element.Current.ControlType == ControlType.Edit
            ? element
            : EditChild(new IntPtr(element.Current.NativeWindowHandle)) is { } edit && edit != IntPtr.Zero
                ? AutomationElement.FromHandle(edit)
                : element;

    private static IntPtr EditChild(IntPtr window)
    {
        IntPtr found = IntPtr.Zero;
        if (window == IntPtr.Zero)
        {
            return found;
        }

        NativeMethods.EnumChildWindows(window, (child, _) =>
        {
            StringBuilder className = new(256);
            NativeMethods.GetClassName(child, className, className.Capacity);
            if (className.ToString().Contains(".EDIT.", StringComparison.OrdinalIgnoreCase) || className.ToString() == "Edit")
            {
                found = child;
                return false;
            }

            return true;
        }, IntPtr.Zero);
        return found;
    }

    /// <summary>
    /// The process's visible top-level window that was not there before the key press and holds menu items, waiting up
    /// to <see cref="MenuTimeout"/>. A WinForms context menu is such a window; it is found through the window list,
    /// since UI Automation does not list it among the desktop's children.
    /// </summary>
    private static AutomationElement WaitForMenu(ActionContext context, string control, IReadOnlySet<IntPtr> before)
    {
        Condition menuItem = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem);
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < MenuTimeout)
        {
            foreach (IntPtr window in TopLevelWindows(context.ProcessId).Where(window => !before.Contains(window)))
            {
                try
                {
                    AutomationElement candidate = AutomationElement.FromHandle(window);
                    if (candidate.FindFirst(TreeScope.Descendants, menuItem) is not null)
                    {
                        return candidate;
                    }
                }
                catch (ElementNotAvailableException)
                {
                    // A window closing while it is read is not the menu that opens.
                }
            }

            Thread.Sleep(100);
        }

        throw new TimeoutException(
            $"No context menu of '{control}' opened within {MenuTimeout.TotalSeconds:0} s; the app's visible top-level windows are " +
            $"{string.Join(", ", TopLevelWindows(context.ProcessId).Select(Describe))}.");
    }

    private static List<IntPtr> TopLevelWindows(int processId)
    {
        List<IntPtr> windows = [];
        NativeMethods.EnumWindows((window, _) =>
        {
            NativeMethods.GetWindowThreadProcessId(window, out int owner);
            if (owner == processId && NativeMethods.IsWindowVisible(window))
            {
                windows.Add(window);
            }

            return true;
        }, IntPtr.Zero);
        return windows;
    }

    private static string Describe(IntPtr window)
    {
        StringBuilder className = new(256);
        NativeMethods.GetClassName(window, className, className.Capacity);
        return $"{window} ({className})";
    }
}