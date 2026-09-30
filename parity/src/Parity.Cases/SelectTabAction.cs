namespace Parity.Cases;

/// <summary>Selects the first visible tab item with this exact name.</summary>
public sealed record SelectTabAction(string TabName, bool Optional) : ParityAction
{
    public override bool Required => !Optional;

    public override string Describe() => $"selectTab:{TabName}";
}
