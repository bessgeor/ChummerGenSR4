namespace Parity.Cases;

/// <summary>One character fixture with the expanded actions to run on it.</summary>
public sealed record ParityCase(
    string Name,
    string CharacterFile,
    string CharacterPath,
    CharacterMode Mode,
    IReadOnlyList<ParityAction> Actions);
