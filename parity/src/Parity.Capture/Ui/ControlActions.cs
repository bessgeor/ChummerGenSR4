namespace Parity.Capture.Ui;

/// <summary>
/// Edits values, presses buttons, selects items and invokes context menu items of the active window, never with the
/// pointer. Each check that the action changed something is part of it.
/// </summary>
internal sealed class ControlActions(IControlAccess access)
{
    /// <summary>
    /// Sets the text of a text box, or of the edit box of a numeric up-down or combo box, and leaves the control with
    /// Tab, so a control that takes its value when it loses focus takes it. Fails when nothing changes or the control
    /// does not hold exactly the value afterwards.
    /// </summary>
    public void SetValue(ActionContext context, string control, string value)
    {
        IValueBox box = access.FindValueBox(context.ActiveWindow, control);
        if (string.Equals(box.Value, value, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"'{control}' already holds '{value}', so setting it would change nothing.");
        }

        box.Focus();
        if (context.Caller.Run($"setValue:{control}", () => box.Set(value), context.CurrentWindow, DialogSafeCaller.Timeout))
        {
            box.LeaveWithTab();
        }

        context.Settle();
        string after = box.Value;
        if (!string.Equals(after, value, StringComparison.Ordinal))
        {
            throw new InvalidOperationException($"'{control}' holds '{after}' after it was set to '{value}'.");
        }
    }

    /// <summary>Invokes a button, or toggles a check box.</summary>
    public void Click(ActionContext context, string control)
    {
        Action call = access.FindPress(context.ActiveWindow, control)
            ?? throw new InvalidOperationException($"'{control}' can be neither invoked nor toggled.");
        context.Caller.Run($"click:{control}", call, context.CurrentWindow, DialogSafeCaller.Timeout);
        context.Settle();
    }

    /// <summary>Selects the item named <paramref name="item"/> among the control's descendants; it must not be selected before and must be after.</summary>
    public void SelectItem(ActionContext context, string control, string item)
    {
        ISelectableItem target = access.FindItem(context.ActiveWindow, control, item);
        if (target.IsSelected)
        {
            throw new InvalidOperationException($"'{item}' is already selected in '{control}', so selecting it would change nothing.");
        }

        context.Caller.Run($"selectItem:{control}={item}", target.Select, context.CurrentWindow, DialogSafeCaller.Timeout);
        context.Settle();
        if (!target.IsSelected)
        {
            throw new InvalidOperationException($"'{item}' is not selected in '{control}' after selecting it.");
        }
    }

    /// <summary>
    /// Opens the control's context menu and invokes the menu item named <paramref name="item"/>. A menu without that
    /// item is closed before the action fails.
    /// </summary>
    public void ContextMenu(ActionContext context, string control, string item)
    {
        IContextMenu menu = access.OpenContextMenu(context, control);
        Action? invoke = menu.Entries.FirstOrDefault(entry => string.Equals(entry.Name, item, StringComparison.Ordinal))?.Invoke;
        if (invoke is null)
        {
            string names = string.Join(", ", menu.Entries.Select(entry => $"'{entry.Name}'"));
            menu.Close();
            throw new InvalidOperationException(
                $"The context menu of '{control}' has no item '{item}' that can be invoked; it has {(names.Length == 0 ? "no items" : names)}.");
        }

        context.Caller.Run($"contextMenu:{control}={item}", invoke, context.CurrentWindow, DialogSafeCaller.Timeout);
        context.Settle();
    }
}