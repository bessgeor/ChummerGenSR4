namespace Parity.Capture.Ui;

/// <summary>An item of a list, drop-down or tree.</summary>
internal interface ISelectableItem
{
    bool IsSelected { get; }

    void Select();
}