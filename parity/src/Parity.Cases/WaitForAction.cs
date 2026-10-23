namespace Parity.Cases;

/// <summary>Waits until a visible UI element with this exact name exists.</summary>
public sealed record WaitForAction(string Label) : ParityAction
{
    public override string Describe() => $"waitFor:{Label}";
}
