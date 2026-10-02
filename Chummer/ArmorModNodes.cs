using System;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// Creates the tree nodes of the armor mods that an armor includes.
	/// </summary>
	public static class ArmorModNodes
	{
		/// <summary>
		/// Create a function that makes the tree node of an included armor mod with a context menu.
		/// </summary>
		/// <param name="cmsArmorMod">ContextMenuStrip to apply to Armor Mod TreeNodes.</param>
		public static Func<ITreeNodeView> Create(ContextMenuStrip cmsArmorMod)
		{
			return () =>
			{
				TreeNode objModNode = new TreeNode();
				objModNode.ContextMenuStrip = cmsArmorMod;
				return new TreeNodeView(objModNode);
			};
		}
	}
}
