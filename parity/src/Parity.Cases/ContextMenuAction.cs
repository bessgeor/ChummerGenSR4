namespace Parity.Cases;

/// <summary>Opens the context menu of a control (of a tree view's selected node) and invokes the item with this name.</summary>
public sealed record ContextMenuAction(string Control, string Item) : ParityAction
{
    public override string Describe() => $"contextMenu:{Control}={Item}";
}
