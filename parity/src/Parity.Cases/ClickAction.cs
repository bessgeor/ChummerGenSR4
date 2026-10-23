namespace Parity.Cases;

/// <summary>Presses a button or toggles a check box of the active window.</summary>
public sealed record ClickAction(string Control) : ParityAction
{
    public override string Describe() => $"click:{Control}";
}
