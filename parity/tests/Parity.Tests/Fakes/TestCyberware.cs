using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A piece of cyberware with the values an attribute reads of a cyberlimb.
/// </summary>
public sealed record TestCyberware(string Category, string LimbSlot, int TotalBody, int TotalStrength, int TotalAgility) : ICharacterCyberware;
