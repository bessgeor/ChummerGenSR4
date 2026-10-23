using Chummer;

namespace Parity.Hosted.Tests;

/// <summary>
/// Selection dialogs that a character's improvement manager holds and no test asks.
/// </summary>
internal sealed class UnaskedDialogs : IImprovementDialogs
{
    public string SelectText(string strFriendlyName, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectRestrictedItem(IImprovementCharacter objCharacter, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectSkill(IImprovementCharacter objCharacter, string strFriendlyName, string strOnlySkillGroup, string strOnlyCategory, string strExcludeCategory, string strLimitToSkill, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectSkillGroup(string strFriendlyName, string strForcedValue, string strExcludeCategory) => throw HostedApplication.Unasked();
    public string SelectAttribute(string strFriendlyName, bool blnAddMAG, bool blnAddRES, List<string> lstLimitTo, List<string> lstRemove, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectSwapSkillAttribute(string strFriendlyName, List<string> lstRemove, List<string> lstLimitTo, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectSpell(IImprovementCharacter objCharacter, string strLimitCategory, string strForcedValue) => throw HostedApplication.Unasked();
    public MentorSpiritSelection SelectMentorSpirit(IImprovementCharacter objCharacter, string strXmlFile) => throw HostedApplication.Unasked();
    public string SelectSide(string strFriendlyName, string strForcedValue) => throw HostedApplication.Unasked();
    public string SelectSprite(List<ListItem> lstSprites) => throw HostedApplication.Unasked();
    public string SelectWeapon(string strFriendlyName, List<ListItem> lstWeapons, string strForcedValue) => throw HostedApplication.Unasked();
}
