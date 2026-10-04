using Parity.Capture.Ui;

namespace Parity.Tests.Fakes;

/// <summary>A window's controls as plain objects: what a find returns, and what the actions did to them.</summary>
internal sealed class FakeControlAccess : IControlAccess
{
    public Dictionary<string, IValueBox> Boxes { get; } = [];

    public Dictionary<string, Action?> Presses { get; } = [];

    public Dictionary<string, FakeItem> Items { get; } = [];

    public Dictionary<string, FakeMenu> Menus { get; } = [];

    public IValueBox FindValueBox(Func<IntPtr> window, string control) =>
        Boxes.TryGetValue(control, out IValueBox? box) ? box : throw Missing(control);

    public Action? FindPress(Func<IntPtr> window, string control) =>
        Presses.TryGetValue(control, out Action? press) ? press : throw Missing(control);

    public ISelectableItem FindItem(Func<IntPtr> window, string control, string item) =>
        Items.TryGetValue($"{control}={item}", out FakeItem? found) ? found : throw Missing(control);

    public IContextMenu OpenContextMenu(ActionContext context, string control) =>
        Menus.TryGetValue(control, out FakeMenu? menu) ? menu : throw Missing(control);

    private static InvalidOperationException Missing(string control) =>
        new($"No enabled control '{control}' is on screen in window 'Fake' after 5 s.");
}

internal sealed class FakeValueBox(string value, Func<string, string>? take = null) : IValueBox
{
    public List<string> Calls { get; } = [];

    public string Value { get; private set; } = value;

    public void Focus() => Calls.Add("focus");

    public void Set(string text)
    {
        Calls.Add($"set:{text}");
        Value = take is null ? text : take(text);
    }

    public void LeaveWithTab() => Calls.Add("tab");
}

internal sealed class FakeItem(bool selected, bool selects = true) : ISelectableItem
{
    public int Selections { get; private set; }

    public bool IsSelected { get; private set; } = selected;

    public void Select()
    {
        Selections++;
        IsSelected = selects;
    }
}

internal sealed class FakeMenu(params MenuEntry[] entries) : IContextMenu
{
    public bool Closed { get; private set; }

    public IReadOnlyList<MenuEntry> Entries { get; } = entries;

    public void Close() => Closed = true;
}