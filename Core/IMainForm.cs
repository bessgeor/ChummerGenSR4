namespace Chummer
{
	/// <summary>
	/// The application's main window, as the options see it.
	/// </summary>
	public interface IMainForm
	{
		/// <summary>
		/// Open a saved character in its own window. These defaults are the only ones: the window that implements this takes all four arguments.
		/// </summary>
		/// <param name="strFileName">File to load.</param>
		/// <param name="blnIncludeInMRU">Whether or not the file should appear in the MRU list.</param>
		/// <param name="strNewName">New name for the character.</param>
		/// <param name="blnClearFileName">Whether or not the name of the save file should be cleared.</param>
		void LoadCharacter(string strFileName, bool blnIncludeInMRU = true, string strNewName = "", bool blnClearFileName = false);
	}
}
