using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// A character as its windows show it: the character and its print preview window.
	/// </summary>
	public sealed class CharacterViewModel
	{
		private readonly Character _objCharacter;
		private frmViewer _frmPrintView;

		/// <summary>
		/// Show a character.
		/// </summary>
		/// <param name="objCharacter">Character to show.</param>
		public CharacterViewModel(Character objCharacter)
		{
			_objCharacter = objCharacter;
		}

		/// <summary>
		/// The character shown.
		/// </summary>
		public Character Character
		{
			get
			{
				return _objCharacter;
			}
		}

		/// <summary>
		/// The frmViewer window being used by the character.
		/// </summary>
		public frmViewer PrintWindow
		{
			get
			{
				return _frmPrintView;
			}
			set
			{
				_frmPrintView = value;
			}
		}

		/// <summary>
		/// Print this character and open the View Character window.
		/// </summary>
		/// <param name="blnDialog">Whether or not the window should be shown as a dialogue window.</param>
		public void Print(bool blnDialog = true)
		{
			// Write the Character information to a MemoryStream so we don't need to create any files.
			MemoryStream objStream = new MemoryStream();
			XmlTextWriter objWriter = new XmlTextWriter(objStream, Encoding.UTF8);

			// Being the document.
			objWriter.WriteStartDocument();

			// </characters>
			objWriter.WriteStartElement("characters");

			_objCharacter.PrintToStream(objStream, objWriter);

			// </characters>
			objWriter.WriteEndElement();

			// Finish the document and flush the Writer and Stream.
			objWriter.WriteEndDocument();
			objWriter.Flush();
			objStream.Flush();

			// Read the stream.
			StreamReader objReader = new StreamReader(objStream);
			objStream.Position = 0;
			XmlDocument objCharacterXML = new XmlDocument();

			// Put the stream into an XmlDocument and send it off to the Viewer.
			string strXML = objReader.ReadToEnd();
			objCharacterXML.LoadXml(strXML);

			objWriter.Close();
			objStream.Close();

			// If a reference to the Viewer window does not yet exist for this character, open a new Viewer window and set the reference to it.
			// If a Viewer window already exists for this character, use it instead.
			if (_frmPrintView == null)
			{
				List<CharacterViewModel> lstCharacters = new List<CharacterViewModel>();
				lstCharacters.Add(this);
				frmViewer frmViewCharacter = new frmViewer();
				frmViewCharacter.Characters = lstCharacters;
				frmViewCharacter.CharacterXML = objCharacterXML;
				_frmPrintView = frmViewCharacter;
				if (blnDialog)
					frmViewCharacter.ShowDialog();
				else
					frmViewCharacter.Show();
			}
			else
			{
				_frmPrintView.Activate();
				_frmPrintView.RefreshView();
			}
		}
	}
}