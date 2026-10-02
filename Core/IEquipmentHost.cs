using System.Xml;

namespace Chummer
{
	/// <summary>
	/// What armor, cyberware and gear need from the application: the choices they ask the user for and the Weapons they grant.
	/// </summary>
	public interface IEquipmentHost
	{
		/// <summary>
		/// Ask for a number, such as a variable cost, in a window that cannot be cancelled.
		/// </summary>
		/// <param name="intMinimum">Smallest number allowed.</param>
		/// <param name="intMaximum">Largest number allowed.</param>
		/// <param name="strDescription">Description shown in the window.</param>
		int SelectNumber(int intMinimum, int intMaximum, string strDescription);

		/// <summary>
		/// Ask for the Weapon category that a piece of Ammunition is limited to. Returns the window's selected category, also when the user closed it.
		/// </summary>
		/// <param name="strDescription">Description shown in the window.</param>
		/// <param name="strOnlyCategory">Category the list is limited to, or "" for every category.</param>
		string SelectWeaponCategory(string strDescription, string strOnlyCategory);

		/// <summary>
		/// Create a Weapon from its XmlNode for a character, without context menus, and show it in a tree node.
		/// The application's host takes only its own character and nodes and throws an ArgumentException for any other.
		/// </summary>
		/// <param name="objXmlWeapon">XmlNode of the Weapon in the data file.</param>
		/// <param name="objCharacter">Character the Weapon is created for.</param>
		/// <param name="objNode">Tree node to populate, from NewNode of the item's node.</param>
		IEquipmentWeapon CreateWeapon(XmlNode objXmlWeapon, ICharacter objCharacter, ITreeNodeView objNode);
	}
}
