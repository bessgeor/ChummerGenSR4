using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// An attribute with the values the improvement manager reads.
/// </summary>
internal sealed record TestAttribute(int TotalValue, int MetatypeMaximum) : IImprovementAttribute;
