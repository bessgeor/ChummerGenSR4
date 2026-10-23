using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A skill with the name and specialization the improvement manager reads.
/// </summary>
internal sealed record TestSkill(string Name, string Specialization) : IImprovementSkill;
