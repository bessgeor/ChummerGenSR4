using System.Drawing;

namespace Chummer
{
	/// <summary>
	/// The colour of a Contact as a Windows Forms colour.
	/// </summary>
	public static class ContactColour
	{
		/// <summary>
		/// The Contact's colour, or Color.Empty when none was chosen.
		/// </summary>
		/// <param name="objContact">Contact to read.</param>
		public static Color GetColour(this Contact objContact)
		{
			if (objContact.ColourArgb == null)
				return Color.Empty;
			return Color.FromArgb(objContact.ColourArgb.Value);
		}

		/// <summary>
		/// Set the Contact's colour; Color.Empty means none was chosen.
		/// </summary>
		/// <param name="objContact">Contact to change.</param>
		/// <param name="objColour">Colour to set.</param>
		public static void SetColour(this Contact objContact, Color objColour)
		{
			if (objColour.IsEmpty)
				objContact.ColourArgb = null;
			else
				objContact.ColourArgb = objColour.ToArgb();
		}
	}
}
