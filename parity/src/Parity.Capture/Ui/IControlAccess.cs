namespace Parity.Capture.Ui;

/// <summary>How the controls of the active window are found and operated; each find fails when the control is missing.</summary>
internal interface IControlAccess
{
    /// <summary>The edit box of the control; fails when the control has no editable value.</summary>
    IValueBox FindValueBox(Func<IntPtr> window, string control);

    /// <summary>What presses the button or toggles the check box, or none when the control can be neither invoked nor toggled.</summary>
    Action? FindPress(Func<IntPtr> window, string control);

    /// <summary>The item named <paramref name="item"/> among the control's descendants; fails when there is none.</summary>
    ISelectableItem FindItem(Func<IntPtr> window, string control, string item);

    /// <summary>Focuses the control, presses the context menu key and waits for the menu that opens.</summary>
    IContextMenu OpenContextMenu(ActionContext context, string control);
}