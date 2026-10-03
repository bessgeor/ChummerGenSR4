using System;
using System.Collections.Generic;

namespace Chummer
{
	/// <summary>
	/// A tree node that is never shown: it keeps in memory what an item fills it with.
	/// </summary>
	public sealed class UnshownTreeNode : ITreeNodeView
	{
		private readonly List<UnshownTreeNode> _lstChildren = new List<UnshownTreeNode>();
		private string _strText = "";
		private object _objTag;
		private bool _blnGrayText;
		private int _intExpansions;

		public string Text
		{
			get
			{
				return _strText;
			}
			set
			{
				_strText = value;
			}
		}

		public object Tag
		{
			get
			{
				return _objTag;
			}
			set
			{
				_objTag = value;
			}
		}

		/// <summary>
		/// Whether or not the node's text was shown in grey.
		/// </summary>
		public bool GrayText
		{
			get
			{
				return _blnGrayText;
			}
		}

		/// <summary>
		/// How often the node was expanded.
		/// </summary>
		public int Expansions
		{
			get
			{
				return _intExpansions;
			}
		}

		public void ShowAsGrayText()
		{
			_blnGrayText = true;
		}

		public ITreeNodeView NewNode()
		{
			return new UnshownTreeNode();
		}

		/// <summary>
		/// Add a node as the last child of this one. Throws an InvalidCastException for a node that is no UnshownTreeNode.
		/// </summary>
		/// <param name="objChild">Node to add.</param>
		public void Add(ITreeNodeView objChild)
		{
			UnshownTreeNode objNode = objChild as UnshownTreeNode;
			if (objNode == null)
				throw new InvalidCastException("An unshown tree node takes only unshown tree nodes as children.");
			_lstChildren.Add(objNode);
		}

		public IEnumerable<ITreeNodeView> Children
		{
			get
			{
				foreach (UnshownTreeNode objChild in _lstChildren)
					yield return objChild;
			}
		}

		public void Expand()
		{
			_intExpansions++;
		}
	}
}