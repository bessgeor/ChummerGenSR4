using System.Drawing;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// A Windows Forms tree node as the tree node view of a created item.
	/// </summary>
	public sealed class TreeNodeView : ITreeNodeView
	{
		private readonly TreeNode _objNode;

		/// <summary>
		/// Show an item in a tree node.
		/// </summary>
		/// <param name="objNode">TreeNode to populate.</param>
		public TreeNodeView(TreeNode objNode)
		{
			_objNode = objNode;
		}

		public string Text
		{
			get
			{
				return _objNode.Text;
			}
			set
			{
				_objNode.Text = value;
			}
		}

		public object Tag
		{
			get
			{
				return _objNode.Tag;
			}
			set
			{
				_objNode.Tag = value;
			}
		}

		public void ShowAsGrayText()
		{
			_objNode.ForeColor = SystemColors.GrayText;
		}
	}
}
