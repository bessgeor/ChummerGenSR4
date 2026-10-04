namespace Parity.Cases;

/// <summary>Saves the character with the app's Save command, closes the app and opens the saved file in a new process.</summary>
public sealed record SaveReloadAction : ParityAction
{
    public override string Describe() => "saveReload";
}
