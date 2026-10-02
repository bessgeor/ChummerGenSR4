using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// Selection dialogs that record the text and skill selections they are asked for and answer them with the
/// configured value (<see langword="null"/> is a cancelled selection). Any other selection fails the test.
/// </summary>
internal sealed class TestDialogs : IImprovementDialogs
{
    public List<string> Calls { get; } = [];
    public string? Text { get; init; }
    public string? Skill { get; init; }

    public string? SelectText(string strFriendlyName, string strForcedValue)
    {
        Calls.Add($"SelectText({strFriendlyName}, {strForcedValue})");
        return Text;
    }

    public string? SelectSkill(IImprovementCharacter objCharacter, string strFriendlyName, string? strOnlySkillGroup, string? strOnlyCategory, string? strExcludeCategory, string? strLimitToSkill, string strForcedValue)
    {
        Calls.Add($"SelectSkill({strOnlySkillGroup}, {strOnlyCategory}, {strExcludeCategory}, {strLimitToSkill}, {strFriendlyName}, {strForcedValue})");
        return Skill;
    }

    public string? SelectRestrictedItem(IImprovementCharacter objCharacter, string strForcedValue) => Unexpected();
    public string? SelectSkillGroup(string strFriendlyName, string strForcedValue, string strExcludeCategory) => Unexpected();
    public string? SelectAttribute(string strFriendlyName, bool blnAddMAG, bool blnAddRES, List<string>? lstLimitTo, List<string>? lstRemove, string strForcedValue) => Unexpected();
    public string? SelectSwapSkillAttribute(string strFriendlyName, List<string> lstRemove, List<string>? lstLimitTo, string strForcedValue) => Unexpected();
    public string? SelectSpell(IImprovementCharacter objCharacter, string? strLimitCategory, string strForcedValue) => Unexpected();
    public MentorSpiritSelection? SelectMentorSpirit(IImprovementCharacter objCharacter, string? strXmlFile) => throw new InvalidOperationException("No test selects a mentor spirit.");
    public string? SelectSide(string strFriendlyName, string strForcedValue) => Unexpected();
    public string? SelectSprite(List<ListItem> lstSprites) => Unexpected();
    public string? SelectWeapon(string strFriendlyName, List<ListItem> lstWeapons, string strForcedValue) => Unexpected();

    private static string Unexpected() => throw new InvalidOperationException("The test asks for no such selection.");
}
