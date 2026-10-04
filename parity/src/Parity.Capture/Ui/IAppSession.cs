namespace Parity.Capture.Ui;

/// <summary>A running app with one character open, driven one action at a time.</summary>
internal interface IAppSession : IDisposable
{
    /// <summary>Brings the app's main window to the foreground; throws <see cref="WindowActivationException"/>.</summary>
    void Activate();

    /// <summary>Selects a tab and waits until it is selected; throws <see cref="TabNotFoundException"/> if no tab has the name.</summary>
    void SelectTab(string tabName);

    void WaitForLabel(string label);

    void Wait(int milliseconds);

    /// <summary>Types a value into a control of the active window and leaves it; fails unless the control then holds exactly that value and held another before.</summary>
    void SetValue(string control, string value);

    /// <summary>Presses a button or toggles a check box of the active window.</summary>
    void Click(string control);

    /// <summary>Selects an item of a list box, combo box or tree view of the active window; fails unless the selection changes to it.</summary>
    void SelectItem(string control, string item);

    /// <summary>Opens the context menu of a control of the active window and invokes one of its items.</summary>
    void ContextMenu(string control, string item);

    /// <summary>Saves the character with the app's Save command, closes the app and opens the saved file in a new process.</summary>
    void SaveReload();

    Bitmap Capture();

    /// <summary>The UI Automation tree of the main window as it is on screen, depth first with parent indexes.</summary>
    IReadOnlyList<Parity.Contracts.UiTree.UiNode> DescribeTree();
}
