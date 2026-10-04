namespace Parity.Cases;

/// <summary>Selects the item with this name in a list box, combo box or tree view of the active window.</summary>
public sealed record SelectItemAction(string Control, string Item) : ParityAction
{
    public override string Describe() => $"selectItem:{Control}={Item}";
}
