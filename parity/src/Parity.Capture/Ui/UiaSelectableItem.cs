using System.Windows.Automation;

namespace Parity.Capture.Ui;

/// <summary>An item through its UI Automation selection item pattern.</summary>
internal sealed class UiaSelectableItem(SelectionItemPattern pattern) : ISelectableItem
{
    public bool IsSelected => pattern.Current.IsSelected;

    public void Select() => pattern.Select();
}