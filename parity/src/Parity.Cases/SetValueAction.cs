namespace Parity.Cases;

/// <summary>Types a value into a text box or numeric up-down of the active window and leaves the control.</summary>
public sealed record SetValueAction(string Control, string Value) : ParityAction
{
    public override string Describe() => $"setValue:{Control}={Value}";
}
