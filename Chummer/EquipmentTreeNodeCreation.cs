using System.Collections.Generic;
using System.Windows.Forms;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// Creates and copies armor, cyberware and gear and shows each in a Windows Forms tree node, adding the Weapons they grant to the caller's lists.
	/// </summary>
	public static class EquipmentTreeNodeCreation
	{
		/// <summary>
		/// Create a Armor Modification from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objMod">Armor Modification to create.</param>
		/// <param name="objXmlArmorNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Rating of the selected ArmorMod.</param>
		/// <param name="objWeapons">List of Weapons that are created by the Armor.</param>
		/// <param name="objWeaponNodes">List of Weapon Nodes that are created by the Armor.</param>
		/// <param name="blnSkipCost">Whether or not creating the Armor should skip the Variable price dialogue (should only be used by frmSelectArmor).</param>
		public static void Create(this ArmorMod objMod, XmlNode objXmlArmorNode, TreeNode objNode, int intRating, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes, bool blnSkipCost = false)
		{
			objMod.Create(objXmlArmorNode, View(objNode), intRating, GrantedWeaponLists.Add(objWeapons, objWeaponNodes), blnSkipCost);
		}

		/// <summary>
		/// Create a piece of Armor from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objArmor">Armor to create.</param>
		/// <param name="objXmlArmorNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="cmsArmorMod">ContextMenuStrip to apply to Armor Mode TreeNodes.</param>
		/// <param name="blnSkipCost">Whether or not creating the Armor should skip the Variable price dialogue (should only be used by frmSelectArmor).</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		public static void Create(this Armor objArmor, XmlNode objXmlArmorNode, TreeNode objNode, ContextMenuStrip cmsArmorMod, bool blnSkipCost = false, bool blnCreateChildren = true)
		{
			objArmor.Create(objXmlArmorNode, View(objNode), ArmorModNodes.Create(cmsArmorMod), blnSkipCost, blnCreateChildren);
		}

		/// <summary>
		/// Create a Cyberware from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objCyberware">Cyberware to create.</param>
		/// <param name="objXmlCyberware">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character object the Cyberware will be added to.</param>
		/// <param name="objGrade">Grade of the selected piece.</param>
		/// <param name="objSource">Source of the piece.</param>
		/// <param name="intRating">Selected Rating of the piece of Cyberware.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="objWeapons">List of Weapons that should be added to the Character.</param>
		/// <param name="objWeaponNodes">List of TreeNode to represent the Weapons added.</param>
		/// <param name="blnCreateImprovements">Whether or not Improvements should be created.</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		/// <param name="strForced">Force a particular value to be selected by an Improvement prompts.</param>
		public static void Create(this Cyberware objCyberware, XmlNode objXmlCyberware, Character objCharacter, Grade objGrade, Improvement.ImprovementSource objSource, int intRating, TreeNode objNode, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes, bool blnCreateImprovements = true, bool blnCreateChildren = true, string strForced = "")
		{
			objCyberware.Create(objXmlCyberware, objCharacter, objGrade, objSource, intRating, View(objNode), GrantedWeaponLists.Add(objWeapons, objWeaponNodes), blnCreateImprovements, blnCreateChildren, strForced);
		}

		/// <summary>
		/// Create a Gear from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objGear">Gear to create.</param>
		/// <param name="objXmlGear">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Gear is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Selected Rating for the Gear.</param>
		/// <param name="objWeapons">List of Weapons that should be added to the character.</param>
		/// <param name="objWeaponNodes">List of TreeNodes to represent the added Weapons</param>
		/// <param name="strForceValue">Value to forcefully select for any ImprovementManager prompts.</param>
		/// <param name="blnHacked">Whether or not a Matrix Program has been hacked (removing the Copy Protection and Registration plugins).</param>
		/// <param name="blnInherent">Whether or not a Program is Inherent to an A.I.</param>
		/// <param name="blnAddImprovements">Whether or not Improvements should be added to the character.</param>
		/// <param name="blnCreateChildren">Whether or not child Gear should be created.</param>
		/// <param name="blnAerodynamic">Whether or not Weapons should be created as Aerodynamic.</param>
		public static void Create(this Gear objGear, XmlNode objXmlGear, Character objCharacter, TreeNode objNode, int intRating, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes, string strForceValue = "", bool blnHacked = false, bool blnInherent = false, bool blnAddImprovements = true, bool blnCreateChildren = true, bool blnAerodynamic = false)
		{
			objGear.Create(objXmlGear, objCharacter, View(objNode), intRating, GrantedWeaponLists.Add(objWeapons, objWeaponNodes), strForceValue, blnHacked, blnInherent, blnAddImprovements, blnCreateChildren, blnAerodynamic);
		}

		/// <summary>
		/// Copy a piece of Gear.
		/// </summary>
		/// <param name="objCopy">Gear to copy into.</param>
		/// <param name="objGear">Gear object to copy.</param>
		/// <param name="objNode">TreeNode for the copied item.</param>
		/// <param name="objWeapons">List of Weapons created by the copied item.</param>
		/// <param name="objWeaponNodes">List of TreeNodes for the Weapons created by the copied item.</param>
		public static void Copy(this Gear objCopy, Gear objGear, TreeNode objNode, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes)
		{
			objCopy.Copy(objGear, View(objNode), GrantedWeaponLists.Add(objWeapons, objWeaponNodes));
		}

		/// <summary>
		/// Create a Commlink from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objCommlink">Commlink to create.</param>
		/// <param name="objXmlGear">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Gear is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Gear Rating.</param>
		/// <param name="blnAddImprovements">Whether or not Improvements should be added to the character.</param>
		/// <param name="blnCreateChildren">Whether or not child Gear should be created.</param>
		public static void Create(this Commlink objCommlink, XmlNode objXmlGear, Character objCharacter, TreeNode objNode, int intRating, bool blnAddImprovements = true, bool blnCreateChildren = true)
		{
			objCommlink.Create(objXmlGear, objCharacter, View(objNode), intRating, blnAddImprovements, blnCreateChildren);
		}

		/// <summary>
		/// Copy a Commlink.
		/// </summary>
		/// <param name="objCopy">Commlink to copy into.</param>
		/// <param name="objGear">Gear object to copy.</param>
		/// <param name="objNode">TreeNode created by copying the item.</param>
		/// <param name="objWeapons">List of Weapons created by copying the item.</param>
		/// <param name="objWeaponNodes">List of Weapon TreeNodes created by copying the item.</param>
		public static void Copy(this Commlink objCopy, Commlink objGear, TreeNode objNode, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes)
		{
			objCopy.Copy(objGear, View(objNode), GrantedWeaponLists.Add(objWeapons, objWeaponNodes));
		}

		/// <summary>
		/// Create an Operating System from an XmlNode and populate its TreeNode.
		/// </summary>
		/// <param name="objOperatingSystem">Operating System to create.</param>
		/// <param name="objXmlGear">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character the Gear is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Selected Rating for the Gear.</param>
		/// <param name="blnAddImprovements">Whether or not Improvements should be added to the character.</param>
		/// <param name="blnCreateChildren">Whether or not child Gear should be created.</param>
		public static void Create(this OperatingSystem objOperatingSystem, XmlNode objXmlGear, Character objCharacter, TreeNode objNode, int intRating, bool blnAddImprovements = true, bool blnCreateChildren = true)
		{
			objOperatingSystem.Create(objXmlGear, objCharacter, View(objNode), intRating, blnAddImprovements, blnCreateChildren);
		}

		/// <summary>
		/// Copy an Operating System.
		/// </summary>
		/// <param name="objCopy">Operating System to copy into.</param>
		/// <param name="objGear">Gear object to copy.</param>
		/// <param name="objNode">TreeNode created by copying the item.</param>
		/// <param name="objWeapons">List of Weapons created by copying the item.</param>
		/// <param name="objWeaponNodes">List of Weapon TreeNodes created by copying the item.</param>
		public static void Copy(this OperatingSystem objCopy, OperatingSystem objGear, TreeNode objNode, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes)
		{
			objCopy.Copy(objGear, View(objNode), GrantedWeaponLists.Add(objWeapons, objWeaponNodes));
		}

		/// <summary>
		/// The view of a TreeNode, or null for none, so that an item reaches a missing node as it did before.
		/// </summary>
		/// <param name="objNode">TreeNode to show the item in.</param>
		private static ITreeNodeView View(TreeNode objNode)
		{
			if (objNode == null)
				return null;
			return new TreeNodeView(objNode);
		}
	}
}
