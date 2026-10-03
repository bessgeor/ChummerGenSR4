using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using System.Xml;
using System.Xml.XPath;

namespace Chummer
{
	/// <summary>
	/// Type of Lifestyle.
	/// </summary>
	public enum LifestyleType
	{
		Standard = 0,
		BoltHole = 1,
		Safehouse = 2,
		Advanced = 3,
	}

	/// <summary>
	/// Lifestyle.
	/// </summary>
	public class Lifestyle
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private int _intCost = 0;
		private int _intDice = 0;
		private int _intMultiplier = 0;
		private int _intMonths = 1;
		private int _intRoommates = 0;
		private int _intPercentage = 100;
		private string _strLifestyleName = "";
		private bool _blnPurchased = false;
		private string _strComforts = "";
		private string _strEntertainment = "";
		private string _strNecessities = "";
		private string _strNeighborhood = "";
		private string _strSecurity = "";
		private string _strSource = "";
		private string _strPage = "";
		private LifestyleType _objType = LifestyleType.Standard;
		private List<string> _lstQualities = new List<string>();
		private string _strNotes = "";

		private readonly Character _objCharacter;

		#region Helper Methods
		/// <summary>
		/// Convert a string to a LifestyleType.
		/// </summary>
		/// <param name="strValue">String value to convert.</param>
		public LifestyleType ConverToLifestyleType(string strValue)
		{
			switch (strValue)
			{
				case "BoltHole":
					return LifestyleType.BoltHole;
				case "Safehouse":
					return LifestyleType.Safehouse;
				case "Advanced":
					return LifestyleType.Advanced;
				default:
					return LifestyleType.Standard;
			}
		}
		#endregion

		#region Constructor, Create, Save, Load, and Print Methods
		public Lifestyle(Character objCharacter)
		{
			// Create the GUID for the new Lifestyle.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Lifestyle from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlLifestyle">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		public void Create(XmlNode objXmlLifestyle, TreeNode objNode)
		{
			_strName = objXmlLifestyle["name"].InnerText;
			_intCost = Convert.ToInt32(objXmlLifestyle["cost"].InnerText);
			_intDice = Convert.ToInt32(objXmlLifestyle["dice"].InnerText);
			_intMultiplier = Convert.ToInt32(objXmlLifestyle["multiplier"].InnerText);
			_strSource = objXmlLifestyle["source"].InnerText;
			_strPage = objXmlLifestyle["page"].InnerText;

			objNode.Text = DisplayName;
			objNode.Tag = _guiID;
		}

		/// <summary>
		/// Save the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Save(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("lifestyle");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("cost", _intCost.ToString());
			objWriter.WriteElementString("dice", _intDice.ToString());
			objWriter.WriteElementString("multiplier", _intMultiplier.ToString());
			objWriter.WriteElementString("months", _intMonths.ToString());
			objWriter.WriteElementString("roommates", _intRoommates.ToString());
			objWriter.WriteElementString("percentage", _intPercentage.ToString());
			objWriter.WriteElementString("lifestylename", _strLifestyleName);
			objWriter.WriteElementString("purchased", _blnPurchased.ToString());
			objWriter.WriteElementString("comforts", _strComforts);
			objWriter.WriteElementString("entertainment", _strEntertainment);
			objWriter.WriteElementString("necessities", _strNecessities);
			objWriter.WriteElementString("neighborhood", _strNeighborhood);
			objWriter.WriteElementString("security", _strSecurity);
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("type", _objType.ToString());
			objWriter.WriteStartElement("qualities");
			foreach (string strQuality in _lstQualities)
				objWriter.WriteElementString("quality", strQuality);
			objWriter.WriteEndElement();
			objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the Attribute from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode, bool blnCopy = false)
		{
			try
			{
				_guiID = Guid.Parse(objNode["guid"].InnerText);
			}
			catch
			{
			}
			_strName = objNode["name"].InnerText;
			_intCost = Convert.ToInt32(objNode["cost"].InnerText);
			_intDice = Convert.ToInt32(objNode["dice"].InnerText);
			_intMultiplier = Convert.ToInt32(objNode["multiplier"].InnerText);
			_intMonths = Convert.ToInt32(objNode["months"].InnerText);
			try
			{
				_intRoommates = Convert.ToInt32(objNode["roommates"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intPercentage = Convert.ToInt32(objNode["percentage"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strLifestyleName = objNode["lifestylename"].InnerText;
			}
			catch
			{
			}
			_blnPurchased = Convert.ToBoolean(objNode["purchased"].InnerText);
			try
			{
				_strComforts = objNode["comforts"].InnerText;
				_strEntertainment = objNode["entertainment"].InnerText;
				_strNecessities = objNode["necessities"].InnerText;
				_strNeighborhood = objNode["neighborhood"].InnerText;
				_strSecurity = objNode["security"].InnerText;
			}
			catch
			{
			}
			_strSource = objNode["source"].InnerText;
			try
			{
				_strPage = objNode["page"].InnerText;
			}
			catch
			{
			}
			try
			{
				foreach (XmlNode objXmlQuality in objNode.SelectNodes("qualities/quality"))
					_lstQualities.Add(objXmlQuality.InnerText);
			}
			catch
			{
			}
			try
			{
				_strNotes = objNode["notes"].InnerText;
			}
			catch
			{
			}

			try
			{
				_objType = ConverToLifestyleType(objNode["type"].InnerText);
			}
			catch
			{
			}

			if (blnCopy)
			{
				_guiID = Guid.NewGuid();
				_intMonths = 0;
			}
		}

		/// <summary>
		/// Print the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Print(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("lifestyle");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("cost", _intCost.ToString());
			objWriter.WriteElementString("dice", _intDice.ToString());
			objWriter.WriteElementString("multiplier", _intMultiplier.ToString());
			objWriter.WriteElementString("months", _intMonths.ToString());
			objWriter.WriteElementString("purchased", _blnPurchased.ToString());
			objWriter.WriteElementString("lifestylename", _strLifestyleName);
			objWriter.WriteElementString("type", _objType.ToString());

			string strComforts = "";
			string strEntertainment = "";
			string strNecessities = "";
			string strNeighborhood = "";
			string strSecurity = "";

			// Retrieve the Advanced Lifestyle information if applicable.
			if (_strComforts != "")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("lifestyles.xml");

				XmlNode objXmlAspect = objXmlDocument.SelectSingleNode("/chummer/comforts/comfort[name = \"" + _strComforts + "\"]");
				if (objXmlAspect["translate"] != null)
					strComforts = objXmlAspect["translate"].InnerText;
				else
					strComforts = objXmlAspect["name"].InnerText;
				objXmlAspect = objXmlDocument.SelectSingleNode("/chummer/entertainments/entertainment[name = \"" + _strEntertainment + "\"]");
				if (objXmlAspect["translate"] != null)
					strEntertainment = objXmlAspect["translate"].InnerText;
				else
					strEntertainment = objXmlAspect["name"].InnerText;
				objXmlAspect = objXmlDocument.SelectSingleNode("/chummer/necessities/necessity[name = \"" + _strNecessities + "\"]");
				if (objXmlAspect["translate"] != null)
					strNecessities = objXmlAspect["translate"].InnerText;
				else
					strNecessities = objXmlAspect["name"].InnerText;
				objXmlAspect = objXmlDocument.SelectSingleNode("/chummer/neighborhoods/neighborhood[name = \"" + _strNeighborhood + "\"]");
				if (objXmlAspect["translate"] != null)
					strNeighborhood = objXmlAspect["translate"].InnerText;
				else
					strNeighborhood = objXmlAspect["name"].InnerText;
				objXmlAspect = objXmlDocument.SelectSingleNode("/chummer/securities/security[name = \"" + _strSecurity + "\"]");
				if (objXmlAspect["translate"] != null)
					strSecurity = objXmlAspect["translate"].InnerText;
				else
					strSecurity = objXmlAspect["name"].InnerText;
			}

			objWriter.WriteElementString("comforts", strComforts);
			objWriter.WriteElementString("entertainment", strEntertainment);
			objWriter.WriteElementString("necessities", strNecessities);
			objWriter.WriteElementString("neighborhood", strNeighborhood);
			objWriter.WriteElementString("security", strSecurity);

			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteStartElement("qualities");

			// Retrieve the Qualities for the Advanced Lifestyle if applicable.
			if (_lstQualities.Count > 0)
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("lifestyles.xml");
				XmlNode objNode;

				foreach (string strQuality in _lstQualities)
				{
					string strThisQuality = "";
					string strQualityName = strQuality.Substring(0, strQuality.IndexOf('[') - 1);
					objNode = objXmlDocument.SelectSingleNode("/chummer/qualities/quality[name = \"" + strQualityName + "\"]");
					if (objNode["translate"] != null)
						strThisQuality += objNode["translate"].InnerText;
					else
						strThisQuality += objNode["name"].InnerText;
					strThisQuality += " [" + objNode["lp"].InnerText + "LP]\n";

					objWriter.WriteElementString("quality", strThisQuality);
				}
			}
			objWriter.WriteEndElement();
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this Lifestyle in the Improvement system.
		/// </summary>
		public string InternalId
		{
			get
			{
				return _guiID.ToString();
			}
		}

		/// <summary>
		/// Name.
		/// </summary>
		public string Name
		{
			get
			{
				return _strName;
			}
			set
			{
				_strName = value;
			}
		}

		/// <summary>
		/// The name of the object as it should be displayed on printouts (translated name only).
		/// </summary>
		public string DisplayNameShort
		{
			get
			{
				string strReturn = _strName;
				// Get the translated name if applicable.
				if (GlobalOptions.Instance.Language != "en-us")
				{
					XmlDocument objXmlDocument = XmlManager.Instance.Load("lifestyles.xml");
					XmlNode objNode = objXmlDocument.SelectSingleNode("/chummer/lifestyles/lifestyle[name = \"" + _strName + "\"]");
					if (objNode != null)
					{
						if (objNode["translate"] != null)
							strReturn = objNode["translate"].InnerText;
					}
				}

				return strReturn;
			}
		}

		/// <summary>
		/// The name of the object as it should be displayed in lists. Name (Extra).
		/// </summary>
		public string DisplayName
		{
			get
			{
				string strReturn = DisplayNameShort;

				if (_strLifestyleName != "")
					strReturn += " (\"" + _strLifestyleName + "\")";

				return strReturn;
			}
		}

		/// <summary>
		/// Sourcebook.
		/// </summary>
		public string Source
		{
			get
			{
				return _strSource;
			}
			set
			{
				_strSource = value;
			}
		}

		/// <summary>
		/// Sourcebook Page Number.
		/// </summary>
		public string Page
		{
			get
			{
				string strReturn = _strPage;
				// Get the translated name if applicable.
				if (GlobalOptions.Instance.Language != "en-us")
				{
					XmlDocument objXmlDocument = XmlManager.Instance.Load("lifestyles.xml");
					XmlNode objNode = objXmlDocument.SelectSingleNode("/chummer/lifestyles/lifestyle[name = \"" + _strName + "\"]");
					if (objNode != null)
					{
						if (objNode["altpage"] != null)
							strReturn = objNode["altpage"].InnerText;
					}
				}

				return strReturn;
			}
			set
			{
				_strPage = value;
			}
		}

		/// <summary>
		/// Cost.
		/// </summary>
		public int Cost
		{
			get
			{
				return _intCost;
			}
			set
			{
				_intCost = value;
			}
		}

		/// <summary>
		/// Number of dice the character rolls to determine their statring Nuyen.
		/// </summary>
		public int Dice
		{
			get
			{
				return _intDice;
			}
			set
			{
				_intDice = value;
			}
		}

		/// <summary>
		/// Number the character multiplies the dice roll with to determine their starting Nuyen.
		/// </summary>
		public int Multiplier
		{
			get
			{
				return _intMultiplier;
			}
			set
			{
				_intMultiplier = value;
			}
		}

		/// <summary>
		/// Months purchased.
		/// </summary>
		public int Months
		{
			get
			{
				return _intMonths;
			}
			set
			{
				_intMonths = value;
			}
		}

		/// <summary>
		/// Whether or not the Lifestyle has been Purchased and no longer rented.
		/// </summary>
		public bool Purchased
		{
			get
			{
				return _blnPurchased;
			}
			set
			{
				_blnPurchased = value;
			}
		}

		/// <summary>
		/// Advance Lifestyle Comforts.
		/// </summary>
		public string Comforts
		{
			get
			{
				return _strComforts;
			}
			set
			{
				_strComforts = value;
			}
		}

		/// <summary>
		/// Advance Lifestyle Comforts.
		/// </summary>
		public string Entertainment
		{
			get
			{
				return _strEntertainment;
			}
			set
			{
				_strEntertainment = value;
			}
		}
		/// <summary>
		/// Advance Lifestyle Necessities.
		/// </summary>
		public string Necessities
		{
			get
			{
				return _strNecessities;
			}
			set
			{
				_strNecessities = value;
			}
		}

		/// <summary>
		/// Advance Lifestyle Neighborhood.
		/// </summary>
		public string Neighborhood
		{
			get
			{
				return _strNeighborhood;
			}
			set
			{
				_strNeighborhood = value;
			}
		}

		/// <summary>
		/// Advance Lifestyle Security.
		/// </summary>
		public string Security
		{
			get
			{
				return _strSecurity;
			}
			set
			{
				_strSecurity = value;
			}
		}

		/// <summary>
		/// Advanced Lifestyle Qualities.
		/// </summary>
		public List<string> Qualities
		{
			get
			{
				return _lstQualities;
			}
		}

		/// <summary>
		/// Notes.
		/// </summary>
		public string Notes
		{
			get
			{
				return _strNotes;
			}
			set
			{
				_strNotes = value;
			}
		}

		/// <summary>
		/// A custom name for the Lifestyle assigned by the player.
		/// </summary>
		public string LifestyleName
		{
			get
			{
				return _strLifestyleName;
			}
			set
			{
				_strLifestyleName = value;
			}
		}

		/// <summary>
		/// Type of the Lifestyle.
		/// </summary>
		public LifestyleType StyleType
		{
			get
			{
				return _objType;
			}
			set
			{
				_objType = value;
			}
		}

		/// <summary>
		/// Number of Roommates this Lifestyle is shared with.
		/// </summary>
		public int Roommates
		{
			get
			{
				return _intRoommates;
			}
			set
			{
				_intRoommates = value;
			}
		}

		/// <summary>
		/// Percentage of the total cost the character pays per month.
		/// </summary>
		public int Percentage
		{
			get
			{
				return _intPercentage;
			}
			set
			{
				_intPercentage = value;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// Total cost of the Lifestyle.
		/// </summary>
		public int TotalCost
		{
			get
			{
				return TotalMonthlyCost * _intMonths;
			}
		}

		/// <summary>
		/// Total monthly cost of the Lifestyle.
		/// </summary>
		public int TotalMonthlyCost
		{
			get
			{
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				double dblMultiplier = 1.0;
				double dblModifier = Convert.ToDouble(objImprovementManager.ValueOf(Improvement.ImprovementType.LifestyleCost), GlobalOptions.Instance.CultureInfo);
				if (_objType == LifestyleType.Standard)
					dblModifier += Convert.ToDouble(objImprovementManager.ValueOf(Improvement.ImprovementType.BasicLifestyleCost), GlobalOptions.Instance.CultureInfo);
				double dblRoommates = 1.0 + (0.1 * _intRoommates);
				dblMultiplier = 1.0 + Convert.ToDouble(dblModifier / 100, GlobalOptions.Instance.CultureInfo);
				double dblPercentage = Convert.ToDouble(_intPercentage, GlobalOptions.Instance.CultureInfo) / 100.0;

				return Convert.ToInt32((Convert.ToDouble(_intCost, GlobalOptions.Instance.CultureInfo) * dblMultiplier) * dblRoommates * dblPercentage);
			}
		}
		#endregion

		#region Methods
		/// <summary>
		/// Set the InternalId for the Lifestyle. Used when editing an Advanced Lifestyle.
		/// </summary>
		/// <param name="strInternalId">InternalId to set.</param>
		public void SetInternalId(string strInternalId)
		{
			_guiID = Guid.Parse(strInternalId);
		}
		#endregion
	}
}