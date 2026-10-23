namespace Parity.Cases;

/// <summary>One character fixture with the expanded actions to run on it.</summary>
public sealed record ParityCase(
    string Name,
    string CharacterFile,
    string CharacterPath,
    CharacterMode Mode,
    IReadOnlyList<ParityAction> Actions)
{
    /// <summary>Whether the case saves the character, so each side needs its own copy of the fixture.</summary>
    public bool Saves => Actions.Any(action => action is SaveReloadAction);
}
