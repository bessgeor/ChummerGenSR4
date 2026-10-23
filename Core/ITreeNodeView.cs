using System.Collections.Generic;

namespace Chummer
{
	/// <summary>
	/// The tree node that shows an item created from the data files.
	/// </summary>
	public interface ITreeNodeView
	{
		/// <summary>
		/// The node's text.
		/// </summary>
		string Text { get; set; }

		/// <summary>
		/// The object the node identifies its item with.
		/// </summary>
		object Tag { get; set; }

		/// <summary>
		/// Show the node's text in the system's grey text colour.
		/// </summary>
		void ShowAsGrayText();

		/// <summary>
		/// Create a new, empty node of the same kind that is in no tree yet.
		/// </summary>
		ITreeNodeView NewNode();

		/// <summary>
		/// Add a node as the last child of this one. The node must be of the same kind: from NewNode, or from a function that the item was given to create its child nodes.
		/// </summary>
		/// <param name="objChild">Node to add.</param>
		void Add(ITreeNodeView objChild);

		/// <summary>
		/// The node's children, in order.
		/// </summary>
		IEnumerable<ITreeNodeView> Children { get; }

		/// <summary>
		/// Expand the node so that its children show.
		/// </summary>
		void Expand();
	}
}
