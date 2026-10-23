namespace Parity.Cases;

/// <summary>Waits a fixed time.</summary>
public sealed record WaitAction(int Milliseconds) : ParityAction
{
    public override string Describe() => $"wait:{Milliseconds}";
}
