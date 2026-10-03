using Chummer;
using Attribute = Chummer.Attribute;

namespace Parity.Tests.Fakes;

/// <summary>
/// A character for the character's items that holds its improvements, its cyberware and the gear its searches find in memory.
/// Every member the tests do not use throws, so a test cannot pass on a value it never set.
/// </summary>
internal sealed class TestItemCharacter : ICharacter
{
    public List<Improvement> Improvements { get; } = [];
    public List<TestCyberware> CyberwareList { get; } = [];
    public IEnumerable<ICharacterCyberware> Cyberware => CyberwareList;
    public bool? IgnoreRulesValue { get; set; }
    public Dictionary<string, Gear> GearById { get; } = [];
    public Dictionary<string, Gear> VehicleGearById { get; } = [];
    public List<string> GearSearches { get; } = [];

    public CharacterOptions Options => throw Unused();
    public string SettingsFile => throw Unused();
    public bool Created => throw Unused();
    public CharacterBuildMethod BuildMethod => throw Unused();
    public bool IsCritter => throw Unused();
    public string MetatypeCategory => throw Unused();
    public string Metatype => throw Unused();
    public bool OverrideSpecialAttributeEssenceLoss => throw Unused();
    public int EssencePenalty => throw Unused();
    public bool IgnoreRules => IgnoreRulesValue ?? throw Unused();
    public Attribute BOD => throw Unused();
    public Attribute STR => throw Unused();
    public Attribute CHA => throw Unused();
    public Attribute INT => throw Unused();
    public Attribute LOG => throw Unused();
    public Attribute WIL => throw Unused();
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
    public Gear FindGear(string strGuid) => Search("gear", GearById, strGuid);
    public Gear FindGearByWeaponID(string strGuid) => throw Unused();
    public Gear FindVehicleGear(string strGuid) => Search("vehicle gear", VehicleGearById, strGuid);
    public void ConvertAdapsinGrades() => throw Unused();

    private Gear Search(string strWhere, Dictionary<string, Gear> gearById, string strGuid)
    {
        GearSearches.Add(strWhere + " " + strGuid);
        return gearById.TryGetValue(strGuid, out Gear? gear) ? gear : null!;
    }

    private static NotSupportedException Unused() => new("The test character does not provide this member.");
}
