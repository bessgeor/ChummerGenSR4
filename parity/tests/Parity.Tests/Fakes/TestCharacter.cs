using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A character for the improvement manager that holds its improvements, flags, skills and attributes in memory
/// and counts the Adapsin grade conversions it is asked for.
/// </summary>
internal sealed class TestCharacter : IImprovementCharacter
{
    public List<Improvement> Improvements { get; } = [];
    public bool MAGEnabled { get; set; }
    public bool RESEnabled { get; set; }
    public bool MagicianEnabled { get; set; }
    public bool AdeptEnabled { get; set; }
    public bool TechnomancerEnabled { get; set; }
    public bool CritterEnabled { get; set; }
    public bool InitiationEnabled { get; set; }
    public bool BlackMarket { get; set; }
    public bool Uneducated { get; set; }
    public bool Uncouth { get; set; }
    public bool Infirm { get; set; }
    public bool AdapsinEnabled => Improvements.Any(objImprovement => objImprovement.ImproveType == Improvement.ImprovementType.Adapsin && objImprovement.Enabled);
    public int InitiateGrade { get; set; }
    public int SubmersionGrade { get; set; }
    public List<TestSkill> SkillList { get; } = [];
    public Dictionary<string, TestAttribute> AttributeList { get; } = [];
    public IEnumerable<IImprovementSkill> Skills => SkillList;
    public IEnumerable<IImprovementWeapon> Weapons => [];
    public int AdapsinConversions { get; private set; }

    public IImprovementAttribute GetAttribute(string strAttribute) =>
        AttributeList.TryGetValue(strAttribute, out TestAttribute? attribute)
            ? attribute
            : throw new InvalidOperationException("The test has no attribute " + strAttribute + ".");

    public void ConvertAdapsinGrades() => AdapsinConversions++;
}
