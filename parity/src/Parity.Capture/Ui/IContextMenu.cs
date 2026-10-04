namespace Parity.Capture.Ui;

/// <summary>A context menu that is open.</summary>
internal interface IContextMenu
{
    IReadOnlyList<MenuEntry> Entries { get; }

    void Close();
}

/// <summary>A menu item by its name without accelerators, and how to invoke it; none when it cannot be invoked.</summary>
internal sealed record MenuEntry(string Name, Action? Invoke);