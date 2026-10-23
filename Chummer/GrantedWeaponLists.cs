using System;
using System.Collections.Generic;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// The function with which armor, cyberware and gear add the Weapons they grant to the caller's lists.
	/// </summary>
	public static class GrantedWeaponLists
	{
		/// <summary>
		/// Create a function that adds a granted Weapon's TreeNode and then the Weapon to the lists, as the items did before. A list that is null throws a NullReferenceException when a Weapon is added.
		/// </summary>
		/// <typeparam name="TWeapon">Type of the Weapon.</typeparam>
		/// <param name="objWeapons">List of Weapons that should be added to the Character.</param>
		/// <param name="objWeaponNodes">List of TreeNodes to represent the Weapons added.</param>
		public static Action<IEquipmentWeapon, ITreeNodeView> Add<TWeapon>(List<TWeapon> objWeapons, List<TreeNode> objWeaponNodes) where TWeapon : IEquipmentWeapon
		{
			return (objWeapon, objWeaponNode) =>
			{
				objWeaponNodes.Add(((TreeNodeView)objWeaponNode).Node);
				objWeapons.Add((TWeapon)objWeapon);
			};
		}
	}
}
