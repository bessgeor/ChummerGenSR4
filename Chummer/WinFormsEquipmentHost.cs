using System;
using System.Windows.Forms;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// The choices of armor, cyberware and gear, asked with the app's selection windows, and the Weapons they grant, created as the app's Weapons.
	/// </summary>
	public sealed class WinFormsEquipmentHost : IEquipmentHost
	{
		public int SelectNumber(int intMinimum, int intMaximum, string strDescription)
		{
			frmSelectNumber frmPickNumber = new frmSelectNumber();
			frmPickNumber.Minimum = intMinimum;
			frmPickNumber.Maximum = intMaximum;
			frmPickNumber.Description = strDescription;
			frmPickNumber.AllowCancel = false;
			frmPickNumber.ShowDialog();
			return frmPickNumber.SelectedValue;
		}

		public string SelectWeaponCategory(string strDescription, string strOnlyCategory)
		{
			frmSelectWeaponCategory frmPickWeaponCategory = new frmSelectWeaponCategory();
			frmPickWeaponCategory.Description = strDescription;
			if (strOnlyCategory != "")
				frmPickWeaponCategory.OnlyCategory = strOnlyCategory;
			frmPickWeaponCategory.ShowDialog();

			return frmPickWeaponCategory.SelectedCategory;
		}

		public IEquipmentWeapon CreateWeapon(XmlNode objXmlWeapon, ICharacter objCharacter, ITreeNodeView objNode)
		{
			Character objAppCharacter = AppArguments.Require<Character>(objCharacter, "objCharacter", "The app's Weapons need the app's Character");
			TreeNodeView objAppNode = AppArguments.Require<TreeNodeView>(objNode, "objNode", "The app's Weapons are shown in a TreeNodeView");
			return CreateGrantedWeapon(objXmlWeapon, objAppCharacter, objAppNode.Node);
		}

		/// <summary>
		/// Create a Weapon that an item grants, without context menus, and populate its TreeNode.
		/// </summary>
		/// <param name="objXmlWeapon">XmlNode of the Weapon in the data file.</param>
		/// <param name="objCharacter">Character the Weapon is created for.</param>
		/// <param name="objNode">TreeNode to populate.</param>
		public static Weapon CreateGrantedWeapon(XmlNode objXmlWeapon, Character objCharacter, TreeNode objNode)
		{
			Weapon objWeapon = new Weapon(objCharacter);
			objWeapon.Create(objXmlWeapon, objCharacter, objNode, null, null, null);
			return objWeapon;
		}
	}
}
