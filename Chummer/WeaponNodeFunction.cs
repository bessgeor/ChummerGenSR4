using System;
using System.Collections.Generic;
using System.Windows.Forms;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// The function with which a Quality adds the Weapon it grants to the character's lists.
	/// </summary>
	public static class WeaponNodeFunction
	{
		/// <summary>
		/// Create a function that makes a Weapon from its XmlNode with its own TreeNode, shows the node in grey text, adds the Weapon and its node to the lists and returns the Weapon's ID.
		/// </summary>
		/// <typeparam name="TWeapon">Type of the Weapon.</typeparam>
		/// <param name="funcCreate">Creates the Weapon from its XmlNode and populates the TreeNode.</param>
		/// <param name="funcInternalId">Reads the Weapon's ID.</param>
		/// <param name="objWeapons">List of Weapons that should be added to the Character.</param>
		/// <param name="objWeaponNodes">List of TreeNodes to represent the Weapons added.</param>
		public static Func<XmlNode, string> Create<TWeapon>(Func<XmlNode, TreeNode, TWeapon> funcCreate, Func<TWeapon, string> funcInternalId, List<TWeapon> objWeapons, List<TreeNode> objWeaponNodes)
		{
			return objXmlWeapon =>
			{
				TreeNode objWeaponNode = new TreeNode();
				TWeapon objWeapon = funcCreate(objXmlWeapon, objWeaponNode);
				new TreeNodeView(objWeaponNode).ShowAsGrayText();
				objWeaponNodes.Add(objWeaponNode);
				objWeapons.Add(objWeapon);
				return funcInternalId(objWeapon);
			};
		}
	}
}
