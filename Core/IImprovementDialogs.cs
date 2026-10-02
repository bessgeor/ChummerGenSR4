using System.Collections.Generic;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// The selections that the bonuses of improvements ask the user for. Each method returns the selected value, or null when the user cancelled.
	/// A forced value of "" forces nothing.
	/// </summary>
	public interface IImprovementDialogs
	{
		/// <summary>
		/// Ask for a text (custom entry for things like Allergy).
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="strForcedValue">Value to take without asking.</param>
		string SelectText(string strFriendlyName, string strForcedValue);

		/// <summary>
		/// Ask for a Restricted item (for Fake Licenses).
		/// </summary>
		/// <param name="objCharacter">Character whose Restricted items are listed.</param>
		/// <param name="strForcedValue">Item to select.</param>
		string SelectRestrictedItem(IImprovementCharacter objCharacter, string strForcedValue);

		/// <summary>
		/// Ask for a Skill. At most one of the filters is not null.
		/// </summary>
		/// <param name="objCharacter">Character whose Skills are listed.</param>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="strOnlySkillGroup">Skill Group to limit the list to, or null.</param>
		/// <param name="strOnlyCategory">Skill category to limit the list to, or null.</param>
		/// <param name="strExcludeCategory">Skill category to leave out of the list, or null.</param>
		/// <param name="strLimitToSkill">Skills to limit the list to, or null.</param>
		/// <param name="strForcedValue">Skill to take without asking.</param>
		string SelectSkill(IImprovementCharacter objCharacter, string strFriendlyName, string strOnlySkillGroup, string strOnlyCategory, string strExcludeCategory, string strLimitToSkill, string strForcedValue);

		/// <summary>
		/// Ask for a Skill Group.
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="strForcedValue">Skill Group to take without asking.</param>
		/// <param name="strExcludeCategory">Skill category whose Skill Groups are left out, or "".</param>
		string SelectSkillGroup(string strFriendlyName, string strForcedValue, string strExcludeCategory);

		/// <summary>
		/// Ask for an Attribute. The list starts with the physical and mental Attributes and EDG, then gets MAG and RES, is limited, and has Attributes removed, in that order.
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="blnAddMAG">Whether or not MAG is added to the list.</param>
		/// <param name="blnAddRES">Whether or not RES is added to the list.</param>
		/// <param name="lstLimitTo">Attributes to limit the list to, or null.</param>
		/// <param name="lstRemove">Attributes to remove from the list, or null.</param>
		/// <param name="strForcedValue">Attribute to take without asking.</param>
		string SelectAttribute(string strFriendlyName, bool blnAddMAG, bool blnAddRES, List<string> lstLimitTo, List<string> lstRemove, string strForcedValue);

		/// <summary>
		/// Ask for the Attribute a Skill uses instead of its own. Attributes are removed from the list, then the list is limited, in that order.
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="lstRemove">Attributes to remove from the list.</param>
		/// <param name="lstLimitTo">Attributes to limit the list to, or null.</param>
		/// <param name="strForcedValue">Attribute to take without asking.</param>
		string SelectSwapSkillAttribute(string strFriendlyName, List<string> lstRemove, List<string> lstLimitTo, string strForcedValue);

		/// <summary>
		/// Ask for a Spell.
		/// </summary>
		/// <param name="objCharacter">Character the Spell is for.</param>
		/// <param name="strLimitCategory">Spell category to limit the list to, or null.</param>
		/// <param name="strForcedValue">Spell to take without asking.</param>
		string SelectSpell(IImprovementCharacter objCharacter, string strLimitCategory, string strForcedValue);

		/// <summary>
		/// Ask for a Mentor Spirit, or with paragons.xml for a Paragon. Returns null when the user cancelled.
		/// </summary>
		/// <param name="objCharacter">Character the Mentor Spirit is for.</param>
		/// <param name="strXmlFile">Data file to list, or null for the Mentor Spirits.</param>
		MentorSpiritSelection SelectMentorSpirit(IImprovementCharacter objCharacter, string strXmlFile);

		/// <summary>
		/// Ask for a side (Left or Right).
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="strForcedValue">Side to take without asking.</param>
		string SelectSide(string strFriendlyName, string strForcedValue);

		/// <summary>
		/// Ask for a Sprite.
		/// </summary>
		/// <param name="lstSprites">Sprites to choose from.</param>
		string SelectSprite(List<ListItem> lstSprites);

		/// <summary>
		/// Ask for one of the character's Weapons.
		/// </summary>
		/// <param name="strFriendlyName">Name of the item that asks, shown in the description.</param>
		/// <param name="lstWeapons">Weapons to choose from.</param>
		/// <param name="strForcedValue">Weapon to take without asking.</param>
		string SelectWeapon(string strFriendlyName, List<ListItem> lstWeapons, string strForcedValue);
	}

	/// <summary>
	/// A selected Mentor Spirit or Paragon with its bonuses and the choices the user made.
	/// </summary>
	public class MentorSpiritSelection
	{
		/// <summary>
		/// Name of the selected Mentor Spirit.
		/// </summary>
		public string SelectedMentor { get; set; }

		/// <summary>
		/// Bonus node of the Mentor Spirit, or null.
		/// </summary>
		public XmlNode BonusNode { get; set; }

		/// <summary>
		/// Name of the first choice.
		/// </summary>
		public string Choice1 { get; set; }

		/// <summary>
		/// Bonus node of the first choice, or null.
		/// </summary>
		public XmlNode Choice1BonusNode { get; set; }

		/// <summary>
		/// Name of the second choice.
		/// </summary>
		public string Choice2 { get; set; }

		/// <summary>
		/// Bonus node of the second choice, or null.
		/// </summary>
		public XmlNode Choice2BonusNode { get; set; }
	}
}
