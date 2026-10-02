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
	}
}
