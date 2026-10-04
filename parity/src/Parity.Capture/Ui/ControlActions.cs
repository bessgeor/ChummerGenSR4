using System.Diagnostics;
using System.Text;
using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// Edits values, presses buttons, selects items and invokes context menu items of the active window through UI
/// Automation and the keyboard, never with the pointer. Each check that the action changed something is part of it.
/// </summary>
internal sealed class ControlActions(ControlFinder finder, KeyboardInput keyboard)
{
    public static readonly TimeSpan MenuTimeout = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Sets the text of a text box, or of the edit box of a numeric up-down or combo box, and leaves the control with
    /// Tab, so a control that takes its value when it loses focus takes it. Fails when nothing changes or the control
    /// does not hold exactly the value afterwards.
    /// </summary>
    public void SetValue(ActionContext context, string control, string value)
    {
        AutomationElement element = finder.Find(context.ActiveWindow, control);
        ValuePattern pattern = EditOf(element, control);
        string before = pattern.Current.Value;
        if (string.Equals(before, value, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"'{control}' already holds '{value}', so setting it would change nothing.");
        }

        element.SetFocus();
        context.Caller.Run($"setValue:{control}", () => pattern.SetValue(value), context.ActiveWindow, DialogSafeCaller.Timeout);
        keyboard.Press(NativeMethods.VkTab);
        context.Settle();
        string after = pattern.Current.Value;
        if (!string.Equals(after, value, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"'{control}' holds '{after}' after it was set to '{value}'.");
        }
    }

    /// <summary>Invokes a button, or toggles a check box.</summary>
    public void Click(ActionContext context, string control)
    {
        AutomationElement element = finder.Find(context.ActiveWindow, control);
        Action call;
        if (element.TryGetCurrentPattern(InvokePattern.Pattern, out object? invoke))
        {
            call = ((InvokePattern)invoke).Invoke;
        }
        else if (element.TryGetCurrentPattern(TogglePattern.Pattern, out object? toggle))
        {
            call = ((TogglePattern)toggle).Toggle;
        }
        else
        {
            throw new InvalidOperationException($"'{control}' can be neither invoked nor toggled.");
        }

        context.Caller.Run($"click:{control}", call, context.ActiveWindow, DialogSafeCaller.Timeout);
        context.Settle();
    }

    /// <summary>Selects the item named <paramref name="item"/> among the control's descendants; it must not be selected before and must be after.</summary>
    public void SelectItem(ActionContext context, string control, string item)
    {
        AutomationElement element = finder.Find(context.ActiveWindow, control);
        SelectionItemPattern pattern = ItemOf(element, control, item);
        if (pattern.Current.IsSelected)
        {
            throw new InvalidOperationException($"'{item}' is already selected in '{control}', so selecting it would change nothing.");
        }

        context.Caller.Run($"selectItem:{control}={item}", pattern.Select, context.ActiveWindow, DialogSafeCaller.Timeout);
        context.Settle();
        if (!pattern.Current.IsSelected)
        {
            throw new InvalidOperationException($"'{item}' is not selected in '{control}' after selecting it.");
        }
    }

    /// <summary>
    /// Focuses the control and presses the context menu key, which makes WinForms show the menu of a tree view's
    /// selected node or of the control, and invokes the menu item named <paramref name="item"/>. A menu without that
    /// item is closed with Escape before the action fails.
    /// </summary>
    public void ContextMenu(ActionContext context, string control, string item)
    {
        AutomationElement element = finder.Find(context.ActiveWindow, control);
        element.SetFocus();
        keyboard.Press(NativeMethods.VkApps);

        AutomationElement menu = WaitForMenu(context, control);
        List<AutomationElement> items = menu.FindAll(
            TreeScope.Descendants,
            new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem)).Cast<AutomationElement>().ToList();
        AutomationElement? match = items.FirstOrDefault(candidate =>
            string.Equals(ControlFinder.WithoutAccelerators(candidate.Current.Name), item, StringComparison.Ordinal));
        if (match is null || !match.TryGetCurrentPattern(InvokePattern.Pattern, out object? invoke))
        {
            string names = string.Join(", ", items.Select(candidate => $"'{candidate.Current.Name}'"));
            keyboard.Press(NativeMethods.VkEscape);
            throw new InvalidOperationException(
                $"The context menu of '{control}' has no item '{item}' that can be invoked; it has {(names.Length == 0 ? "no items" : names)}.");
        }

        context.Caller.Run($"contextMenu:{control}={item}", ((InvokePattern)invoke).Invoke, context.ActiveWindow, DialogSafeCaller.Timeout);
        context.Settle();
    }

    /// <summary>
    /// The value pattern a typed value goes to: the control's own when it is an edit box, else that of its first child
    /// window that is an edit box. A numeric up-down shows only its buttons in the control view; its edit box is a
    /// child window all the same.
    /// </summary>
    private static ValuePattern EditOf(AutomationElement element, string control)
    {
        AutomationElement target = element.Current.ControlType == ControlType.Edit
            ? element
            : EditChild(new IntPtr(element.Current.NativeWindowHandle)) is { } edit && edit != IntPtr.Zero
                ? AutomationElement.FromHandle(edit)
                : element;
        if (!target.TryGetCurrentPattern(ValuePattern.Pattern, out object? pattern) || ((ValuePattern)pattern).Current.IsReadOnly)
        {
            throw new InvalidOperationException($"'{control}' has no editable value.");
        }

        return (ValuePattern)pattern;
    }

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

    private static SelectionItemPattern ItemOf(AutomationElement element, string control, string item)
    {
        foreach (AutomationElement candidate in element.FindAll(TreeScope.Descendants, new PropertyCondition(AutomationElement.NameProperty, item)))
        {
            if (candidate.TryGetCurrentPattern(SelectionItemPattern.Pattern, out object? pattern))
            {
                return (SelectionItemPattern)pattern;
            }
        }

        throw new InvalidOperationException($"'{control}' has no selectable item '{item}'.");
    }

    /// <summary>
    /// The process's visible top-level window, other than the active one, that holds menu items, waiting up to
    /// <see cref="MenuTimeout"/>. A WinForms context menu is such a window; it is found through the window list,
    /// since UI Automation does not list it among the desktop's children.
    /// </summary>
    private static AutomationElement WaitForMenu(ActionContext context, string control)
    {
        Condition menuItem = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem);
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < MenuTimeout)
        {
            IntPtr active = context.ActiveWindow();
            foreach (IntPtr window in TopLevelWindows(context.ProcessId).Where(window => window != active))
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