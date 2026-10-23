using System.Collections.Generic;
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

		/// <summary>
		/// The Windows Forms tree node this view shows the item in.
		/// </summary>
		public TreeNode Node
		{
			get
			{
				return _objNode;
			}
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

		public ITreeNodeView NewNode()
		{
			return new TreeNodeView(new TreeNode());
		}

		/// <summary>
		/// Add a node as the last child of this one. Throws an InvalidCastException for a node that is no TreeNodeView.
		/// </summary>
		/// <param name="objChild">Node to add.</param>
		public void Add(ITreeNodeView objChild)
		{
			_objNode.Nodes.Add(((TreeNodeView)objChild)._objNode);
		}

		public IEnumerable<ITreeNodeView> Children
		{
			get
			{
				foreach (TreeNode objChild in _objNode.Nodes)
					yield return new TreeNodeView(objChild);
			}
		}

		public void Expand()
		{
			_objNode.Expand();
		}
	}
}
