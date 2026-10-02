using System;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// Creates the character's items from the data files and shows each in a Windows Forms tree node.
	/// </summary>
	public static class TreeNodeCreation
	{
		/// <summary>
		/// Create a Quality from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objQuality">Quality to create.</param>
		/// <param name="objXmlQuality">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character object the Quality will be added to.</param>
		/// <param name="objQualitySource">Source of the Quality.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="objWeapons">List of Weapons that should be added to the Character.</param>
		/// <param name="objWeaponNodes">List of TreeNodes to represent the Weapons added.</param>
		/// <param name="strForceValue">Force a value to be selected for the Quality.</param>
		public static void Create(this Quality objQuality, XmlNode objXmlQuality, Character objCharacter, QualitySource objQualitySource, TreeNode objNode, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes, string strForceValue = "")
		{
			Func<XmlNode, string> funcAddWeapon = WeaponNodeFunction.Create(
				(objXmlWeapon, objGearWeaponNode) => WinFormsEquipmentHost.CreateGrantedWeapon(objXmlWeapon, objCharacter, objGearWeaponNode),
				objGearWeapon => objGearWeapon.InternalId,
				objWeapons,
				objWeaponNodes);
			objQuality.Create(objXmlQuality, objCharacter, objQualitySource, new TreeNodeView(objNode), funcAddWeapon, strForceValue);
		}

		/// <summary>
		/// Create a Spell from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objSpell">Spell to create.</param>
		/// <param name="objXmlSpellNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Spell is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="strForcedValue">Value to forcefully select for any ImprovementManager prompts.</param>
		/// <param name="blnLimited">Whether or not the Spell should be marked as Limited.</param>
		/// <param name="blnExtended">Whether or not the Spell should be marked as Extended.</param>
		public static void Create(this Spell objSpell, XmlNode objXmlSpellNode, Character objCharacter, TreeNode objNode, string strForcedValue = "", bool blnLimited = false, bool blnExtended = false)
		{
			objSpell.Create(objXmlSpellNode, objCharacter, new TreeNodeView(objNode), strForcedValue, blnLimited, blnExtended);
		}

		/// <summary>
		/// Create a Metamagic from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objMetamagic">Metamagic to create.</param>
		/// <param name="objXmlMetamagicNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Metamagic is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="objSource">Source of the Improvement.</param>
		public static void Create(this Metamagic objMetamagic, XmlNode objXmlMetamagicNode, Character objCharacter, TreeNode objNode, Improvement.ImprovementSource objSource)
		{
			objMetamagic.Create(objXmlMetamagicNode, objCharacter, new TreeNodeView(objNode), objSource);
		}

		/// <summary>
		/// Create a Complex Form from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objProgram">Complex Form to create.</param>
		/// <param name="objXmlProgramNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Complex Form is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="strForcedValue">Value to forcefully select for any ImprovementManager prompts.</param>
		public static void Create(this TechProgram objProgram, XmlNode objXmlProgramNode, Character objCharacter, TreeNode objNode, string strForcedValue = "")
		{
			objProgram.Create(objXmlProgramNode, objCharacter, new TreeNodeView(objNode), strForcedValue);
		}

		/// <summary>
		/// Create a Complex Form Option from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objOption">Complex Form Option to create.</param>
		/// <param name="objXmlOptionNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Complex Form Option is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="strForcedValue">Value to forcefully select for any ImprovementManager prompts.</param>
		public static void Create(this TechProgramOption objOption, XmlNode objXmlOptionNode, Character objCharacter, TreeNode objNode, string strForcedValue = "")
		{
			objOption.Create(objXmlOptionNode, objCharacter, new TreeNodeView(objNode), strForcedValue);
		}

		/// <summary>
		/// Create a Martial Art from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objMartialArt">Martial Art to create.</param>
		/// <param name="objXmlArtNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="objCharacter">Character the Martial Art is being added to.</param>
		public static void Create(this MartialArt objMartialArt, XmlNode objXmlArtNode, TreeNode objNode, Character objCharacter)
		{
			objMartialArt.Create(objXmlArtNode, new TreeNodeView(objNode), objCharacter);
		}

		/// <summary>
		/// Create a Martial Art Advantage from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objAdvantage">Martial Art Advantage to create.</param>
		/// <param name="objXmlAdvantageNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Martial Art Advantage is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		public static void Create(this MartialArtAdvantage objAdvantage, XmlNode objXmlAdvantageNode, Character objCharacter, TreeNode objNode)
		{
			objAdvantage.Create(objXmlAdvantageNode, objCharacter, new TreeNodeView(objNode));
		}

		/// <summary>
		/// Create a Martial Art Maneuver from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objManeuver">Martial Art Maneuver to create.</param>
		/// <param name="objXmlManeuverNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		public static void Create(this MartialArtManeuver objManeuver, XmlNode objXmlManeuverNode, TreeNode objNode)
		{
			objManeuver.Create(objXmlManeuverNode, new TreeNodeView(objNode));
		}

		/// <summary>
		/// Create a Critter Power from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objPower">Critter Power to create.</param>
		/// <param name="objXmlPowerNode">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Critter Power is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Selected Rating for the Critter Power.</param>
		/// <param name="strForcedValue">Value to forcefully select for any ImprovementManager prompts.</param>
		public static void Create(this CritterPower objPower, XmlNode objXmlPowerNode, Character objCharacter, TreeNode objNode, int intRating = 0, string strForcedValue = "")
		{
			objPower.Create(objXmlPowerNode, objCharacter, new TreeNodeView(objNode), intRating, strForcedValue);
		}
	}
}
