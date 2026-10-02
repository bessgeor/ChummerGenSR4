using Chummer;
using Attribute = Chummer.Attribute;

namespace Parity.Tests.Fakes;

/// <summary>
/// A character for the character's items that holds its improvements and cyberware in memory.
/// Every member the tests do not use throws, so a test cannot pass on a value it never set.
/// </summary>
internal sealed class TestItemCharacter : ICharacter
{
    public List<Improvement> Improvements { get; } = [];
    public List<TestCyberware> CyberwareList { get; } = [];
    public IEnumerable<ICharacterCyberware> Cyberware => CyberwareList;

    public CharacterOptions Options => throw Unused();
    public string SettingsFile => throw Unused();
    public bool Created => throw Unused();
    public CharacterBuildMethod BuildMethod => throw Unused();
    public bool IsCritter => throw Unused();
    public string MetatypeCategory => throw Unused();
    public bool OverrideSpecialAttributeEssenceLoss => throw Unused();
    public int EssencePenalty => throw Unused();
    public Attribute MAG => throw Unused();
    public int MAGMagician => throw Unused();
    public int WoundModifiers => throw Unused();
    public bool SkillsoftAccess => throw Unused();
    public List<Skill> Skills => throw Unused();
    public List<SkillGroup> SkillGroups => throw Unused();
    public List<Quality> Qualities => throw Unused();
    public List<TechProgram> TechPrograms => throw Unused();
    public IEnumerable<ICharacterGear> Gear => throw Unused();
    public bool MAGEnabled { get => throw Unused(); set => throw Unused(); }
    public bool RESEnabled { get => throw Unused(); set => throw Unused(); }
    public bool MagicianEnabled { get => throw Unused(); set => throw Unused(); }
    public bool AdeptEnabled { get => throw Unused(); set => throw Unused(); }
    public bool TechnomancerEnabled { get => throw Unused(); set => throw Unused(); }
    public bool CritterEnabled { get => throw Unused(); set => throw Unused(); }
    public bool InitiationEnabled { get => throw Unused(); set => throw Unused(); }
    public bool BlackMarket { get => throw Unused(); set => throw Unused(); }
    public bool Uneducated { get => throw Unused(); set => throw Unused(); }
    public bool Uncouth { get => throw Unused(); set => throw Unused(); }
    public bool Infirm { get => throw Unused(); set => throw Unused(); }
    public bool AdapsinEnabled => throw Unused();
    public int InitiateGrade { get => throw Unused(); set => throw Unused(); }
    public int SubmersionGrade { get => throw Unused(); set => throw Unused(); }
    IEnumerable<IImprovementSkill> IImprovementCharacter.Skills => throw Unused();
    public IEnumerable<IImprovementWeapon> Weapons => throw Unused();

    public Attribute GetAttribute(string strAttribute) => throw Unused();
    IImprovementAttribute IImprovementCharacter.GetAttribute(string strAttribute) => throw Unused();
    public string GetObjectName(Improvement objImprovement) => throw Unused();
    public void ConvertAdapsinGrades() => throw Unused();

    private static NotSupportedException Unused() => new("The test character does not provide this member.");
}
