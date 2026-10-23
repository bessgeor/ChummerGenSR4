using System;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// Creates the tree nodes of the items that an item includes, each with the context menu of its kind.
	/// </summary>
	public static class ContextMenuNodes
	{
		/// <summary>
		/// Create a function that makes a new tree node with a context menu.
		/// </summary>
		/// <param name="cmsMenu">ContextMenuStrip to apply to the TreeNodes, or null for none.</param>
		public static Func<ITreeNodeView> Create(ContextMenuStrip cmsMenu)
		{
			return () =>
			{
				TreeNode objNode = new TreeNode();
				objNode.ContextMenuStrip = cmsMenu;
				return new TreeNodeView(objNode);
			};
		}
	}
}
