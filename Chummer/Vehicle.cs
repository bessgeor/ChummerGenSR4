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
	/// Vehicle Modification.
	/// </summary>
	public class VehicleMod
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private string _strLimit = "";
		private string _strSlots = "0";
		private int _intRating = 0;
		private string _strMaxRating = "0";
		private string _strCost = "";
		private string _strAvail = "";
		private XmlNode _nodBonus;
		private string _strSource = "";
		private string _strPage = "";
		private bool _blnIncludeInVehicle = false;
		private bool _blnInstalled = true;
		private int _intResponse = 0;
		private int _intSystem = 0;
		private int _intFirewall = 0;
		private int _intSignal = 0;
		private int _intPilot = 0;
		private List<Weapon> _lstVehicleWeapons = new List<Weapon>();
		private string _strNotes = "";
		private string _strSubsystems = "";
		private List<Cyberware> _lstCyberware = new List<Cyberware>();
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private string _strExtra = "";
		private bool _blnDiscountCost = false;

		// Variables used to calculate the Mod's cost from the Vehicle.
		private int _intVehicleCost = 0;
		private int _intBody = 0;
		private int _intSpeed = 0;
		private int _intAccelRunning = 0;
		private int _intAccelWalking = 0;

		private readonly Character _objCharacter;

		#region Constructor, Create, Save, Load, and Print Methods
		public VehicleMod(Character objCharacter)
		{
			// Create the GUID for the new VehicleMod.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Vehicle Modification from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlMod">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Selected Rating for the Gear.</param>
		public void Create(XmlNode objXmlMod, TreeNode objNode, int intRating)
		{
			_strName = objXmlMod["name"].InnerText;
			_strCategory = objXmlMod["category"].InnerText;
			try
			{
				_strLimit = objXmlMod["limit"].InnerText;
			}
			catch
			{
			}

			_strSlots = objXmlMod["slots"].InnerText;
			if (intRating != 0)
			{
				_intRating = Convert.ToInt32(intRating);
			}
			if (objXmlMod["rating"] != null)
				_strMaxRating = objXmlMod["rating"].InnerText;
			else
				_strMaxRating = "0";
			try
			{
				_intResponse = Convert.ToInt32(objXmlMod["response"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSystem = Convert.ToInt32(objXmlMod["system"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intFirewall = Convert.ToInt32(objXmlMod["firewall"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSignal = Convert.ToInt32(objXmlMod["signal"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intPilot = Convert.ToInt32(objXmlMod["pilot"].InnerText);
			}
			catch
			{
			}
			// Add Subsytem information if applicable.
			if (objXmlMod.InnerXml.Contains("subsystems"))
			{
				string strSubsystem = "";
				foreach (XmlNode objXmlSubsystem in objXmlMod.SelectNodes("subsystems/subsystem"))
				{
					strSubsystem += objXmlSubsystem.InnerText + ",";
				}
				_strSubsystems = strSubsystem;
			}
			_strAvail = objXmlMod["avail"].InnerText;
			
			// Check for a Variable Cost.
			if (objXmlMod["cost"] != null)
			{
				if (objXmlMod["cost"].InnerText.StartsWith("Variable"))
				{
					int intMin = 0;
					int intMax = 0;
					string strCost = objXmlMod["cost"].InnerText.Replace("Variable(", string.Empty).Replace(")", string.Empty);
					if (strCost.Contains("-"))
					{
						string[] strValues = strCost.Split('-');
						intMin = Convert.ToInt32(strValues[0]);
						intMax = Convert.ToInt32(strValues[1]);
					}
					else
						intMin = Convert.ToInt32(strCost.Replace("+", string.Empty));

					if (intMin != 0 || intMax != 0)
					{
						frmSelectNumber frmPickNumber = new frmSelectNumber();
						if (intMax == 0)
							intMax = 1000000;
						frmPickNumber.Minimum = intMin;
						frmPickNumber.Maximum = intMax;
						frmPickNumber.Description = LanguageManager.Instance.GetString("String_SelectVariableCost").Replace("{0}", DisplayNameShort);
						frmPickNumber.AllowCancel = false;
						frmPickNumber.ShowDialog();
						_strCost = frmPickNumber.SelectedValue.ToString();
					}
				}
				else
					_strCost = objXmlMod["cost"].InnerText;
			}

			_strSource = objXmlMod["source"].InnerText;
			_strPage = objXmlMod["page"].InnerText;
			if (objXmlMod["bonus"] != null)
				_nodBonus = objXmlMod["bonus"];

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("vehicles.xml");
				XmlNode objModNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objModNode != null)
				{
					if (objModNode["translate"] != null)
						_strAltName = objModNode["translate"].InnerText;
					if (objModNode["altpage"] != null)
						_strAltPage = objModNode["altpage"].InnerText;
				}

				objModNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objModNode != null)
				{
					if (objModNode.Attributes["translate"] != null)
						_strAltCategory = objModNode.Attributes["translate"].InnerText;
				}
			}

			objNode.Text = DisplayName;
			objNode.Tag = _guiID.ToString();
		}

		/// <summary>
		/// Save the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Save(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("mod");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("limit", _strLimit);
			objWriter.WriteElementString("slots", _strSlots);
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("maxrating", _strMaxRating);
			objWriter.WriteElementString("response", _intResponse.ToString());
			objWriter.WriteElementString("system", _intSystem.ToString());
			objWriter.WriteElementString("firewall", _intFirewall.ToString());
			objWriter.WriteElementString("signal", _intSignal.ToString());
			objWriter.WriteElementString("pilot", _intPilot.ToString());
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _strCost);
			objWriter.WriteElementString("extra", _strExtra);
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("included", _blnIncludeInVehicle.ToString());
			objWriter.WriteElementString("installed", _blnInstalled.ToString());
			objWriter.WriteElementString("subsystems", _strSubsystems);
			objWriter.WriteStartElement("weapons");
			foreach (Weapon objWeapon in _lstVehicleWeapons)
				objWeapon.Save(objWriter);
			objWriter.WriteEndElement();
			if (_lstCyberware.Count > 0)
			{
				objWriter.WriteStartElement("cyberwares");
				foreach (Cyberware objCyberware in _lstCyberware)
					objCyberware.Save(objWriter);
				objWriter.WriteEndElement();
			}
			if (_nodBonus != null)
				objWriter.WriteRaw(_nodBonus.OuterXml);
			objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteElementString("discountedcost", DiscountCost.ToString());
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the VehicleMod from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode, bool blnCopy = false)
		{
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strCategory = objNode["category"].InnerText;
			_strLimit = objNode["limit"].InnerText;
			_strSlots = objNode["slots"].InnerText;
			_intRating = Convert.ToInt32(objNode["rating"].InnerText);
			_strMaxRating = objNode["maxrating"].InnerText;
			try
			{
				_intResponse = Convert.ToInt32(objNode["response"].InnerText);
				_intSystem = Convert.ToInt32(objNode["system"].InnerText);
				_intFirewall = Convert.ToInt32(objNode["firewall"].InnerText);
				_intSignal = Convert.ToInt32(objNode["signal"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intPilot = Convert.ToInt32(objNode["pilot"].InnerText);
			}
			catch
			{
			}
			_strAvail = objNode["avail"].InnerText;
			_strCost = objNode["cost"].InnerText;
			_strSource = objNode["source"].InnerText;
			try
			{
				_strPage = objNode["page"].InnerText;
			}
			catch
			{
			}

			_blnIncludeInVehicle = Convert.ToBoolean(objNode["included"].InnerText);
			try
			{
				_blnInstalled = Convert.ToBoolean(objNode["installed"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strSubsystems = objNode["subsystems"].InnerText;
			}
			catch
			{
			}

			if (objNode.InnerXml.Contains("<weapons>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("weapons/weapon");
				foreach (XmlNode nodChild in nodChildren)
				{
					Weapon objWeapon = new Weapon(_objCharacter);
					objWeapon.Load(nodChild, blnCopy);
					_lstVehicleWeapons.Add(objWeapon);
				}
			}
			if (objNode.InnerXml.Contains("<cyberwares>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("cyberwares/cyberware");
				foreach (XmlNode nodChild in nodChildren)
				{
					Cyberware objCyberware = new Cyberware(_objCharacter);
					objCyberware.Load(nodChild, blnCopy);
					_lstCyberware.Add(objCyberware);
				}
			}
			try
			{
				_nodBonus = objNode["bonus"];
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
				_blnDiscountCost = Convert.ToBoolean(objNode["discountedcost"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strExtra = objNode["extra"].InnerText;
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("vehicles.xml");
				XmlNode objModNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objModNode != null)
				{
					if (objModNode["translate"] != null)
						_strAltName = objModNode["translate"].InnerText;
					if (objModNode["altpage"] != null)
						_strAltPage = objModNode["altpage"].InnerText;
				}

				objModNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objModNode != null)
				{
					if (objModNode.Attributes["translate"] != null)
						_strAltCategory = objModNode.Attributes["translate"].InnerText;
				}
			}

			if (blnCopy)
			{
				_guiID = Guid.NewGuid();
			}
		}

		/// <summary>
		/// Print the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Print(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("mod");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("limit", _strLimit);
			objWriter.WriteElementString("slots", _strSlots);
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("included", _blnIncludeInVehicle.ToString());
			objWriter.WriteStartElement("weapons");
			foreach (Weapon objWeapon in _lstVehicleWeapons)
				objWeapon.Print(objWriter);
			objWriter.WriteEndElement();
			objWriter.WriteStartElement("cyberwares");
			foreach (Cyberware objCyberware in _lstCyberware)
				objCyberware.Print(objWriter);
			objWriter.WriteEndElement();
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Weapons.
		/// </summary>
		public List<Weapon> Weapons
		{
			get
			{
				return _lstVehicleWeapons;
			}
		}

		public List<Cyberware> Cyberware
		{
			get
			{
				return _lstCyberware;
			}
		}

		/// <summary>
		/// Internal identifier which will be used to identify this piece of Gear in the Character.
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
		/// Translated Category.
		/// </summary>
		public string DisplayCategory
		{
			get
			{
				string strReturn = _strCategory;
				if (_strAltCategory != string.Empty)
					strReturn = _strAltCategory;

				return strReturn;
			}
		}

		/// <summary>
		/// Category.
		/// </summary>
		public string Category
		{
			get
			{
				return _strCategory;
			}
			set
			{
				_strCategory = value;
			}
		}

		/// <summary>
		/// Which Vehicle types the Mod is limited to.
		/// </summary>
		public string Limit
		{
			get
			{
				return _strLimit;
			}
			set
			{
				_strLimit = value;
			}
		}

		/// <summary>
		/// Number of Slots the Mod uses.
		/// </summary>
		public string Slots
		{
			get
			{
				return _strSlots;
			}
			set
			{
				_strSlots = value;
			}
		}

		/// <summary>
		/// Rating.
		/// </summary>
		public int Rating
		{
			get
			{
				return _intRating;
			}
			set
			{
				_intRating = value;
			}
		}

		/// <summary>
		/// Maximum Rating.
		/// </summary>
		public string MaxRating
		{
			get
			{
				return _strMaxRating;
			}
			set
			{
				_strMaxRating = value;
			}
		}

		/// <summary>
		/// Response.
		/// </summary>
		public int Response
		{
			get
			{
				return _intResponse;
			}
			set
			{
				_intResponse = value;
			}
		}

		/// <summary>
		/// System.
		/// </summary>
		public int System
		{
			get
			{
				return _intSystem;
			}
			set
			{
				_intSystem = value;
			}
		}

		/// <summary>
		/// Firewall.
		/// </summary>
		public int Firewall
		{
			get
			{
				return _intFirewall;
			}
			set
			{
				_intFirewall = value;
			}
		}

		/// <summary>
		/// Signal.
		/// </summary>
		public int Signal
		{
			get
			{
				return _intSignal;
			}
			set
			{
				_intSignal = value;
			}
		}

		/// <summary>
		/// Pilot.
		/// </summary>
		public int Pilot
		{
			get
			{
				return _intPilot;
			}
			set
			{
				_intPilot = value;
			}
		}

		/// <summary>
		/// Cost.
		/// </summary>
		public string Cost
		{
			get
			{
				return _strCost;
			}
			set
			{
				_strCost = value;
			}
		}

		/// <summary>
		/// Availability.
		/// </summary>
		public string Avail
		{
			get
			{
				return _strAvail;
			}
			set
			{
				_strAvail = value;
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
				if (_strAltPage != string.Empty)
					strReturn = _strAltPage;

				return strReturn;
			}
			set
			{
				_strPage = value;
			}
		}

		/// <summary>
		/// Bonus node.
		/// </summary>
		public XmlNode Bonus
		{
			get
			{
				return _nodBonus;
			}
			set
			{
				_nodBonus = value;
			}
		}

		/// <summary>
		/// Whether or not the Mod included with the Vehicle by default.
		/// </summary>
		public bool IncludedInVehicle
		{
			get
			{
				return _blnIncludeInVehicle;
			}
			set
			{
				_blnIncludeInVehicle = value;
			}
		}

		/// <summary>
		/// Whether or not this Mod is installed and contributing towards the Vehicle's stats.
		/// </summary>
		public bool Installed
		{
			get
			{
				return _blnInstalled;
			}
			set
			{
				_blnInstalled = value;
			}
		}

		// Properties used to calculate the Mod's cost from the Vehicle.
		public int VehicleCost
		{
			get
			{
				return _intVehicleCost;
			}
			set
			{
				_intVehicleCost = value;
			}
		}

		public int Body
		{
			get
			{
				return _intBody;
			}
			set
			{
				_intBody = value;
			}
		}

		public int Speed
		{
			get
			{
				return _intSpeed;
			}
			set
			{
				_intSpeed = value;
			}
		}

		public int AccelRunning
		{
			get
			{
				return _intAccelRunning;
			}
			set
			{
				_intAccelRunning = value;
			}
		}

		public int AccelWalking
		{
			get
			{
				return _intAccelWalking;
			}
			set
			{
				_intAccelWalking = value;
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
		/// Whether or not the Vehicle Mod allows Cyberware Plugins.
		/// </summary>
		public bool AllowCyberware
		{
			get
			{
				if (_strSubsystems == "")
					return false;
				else
					return true;
			}
		}

		/// <summary>
		/// Allowed Cyberwarre Subsystems.
		/// </summary>
		public string Subsystems
		{
			get
			{
				return _strSubsystems;
			}
			set
			{
				_strSubsystems = value;
			}
		}

		/// <summary>
		/// Value that was selected during an ImprovementManager dialogue.
		/// </summary>
		public string Extra
		{
			get
			{
				return _strExtra;
			}
			set
			{
				_strExtra = value;
			}
		}

		/// <summary>
		/// Whether or not the Armor's cost should be discounted by 10% through the Black Market Pipeline Quality.
		/// </summary>
		public bool DiscountCost
		{
			get
			{
				if (_objCharacter.Created)
					return false;
				else
					return _blnDiscountCost;
			}
			set
			{
				_blnDiscountCost = value;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// Total Availablility of the VehicleMod.
		/// </summary>
		public string TotalAvail
		{
			get
			{
				// If the Avail contains "+", return the base string and don't try to calculate anything since we're looking at a child component.
				if (_strAvail.StartsWith("+"))
					return _strAvail;

				string strCalculated = "";
				string strReturn = "";

				if (_strAvail.Contains("Rating"))
				{
					// If the availability is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strAvail = "";
					string strAvailExpr = _strAvail;

					if (strAvailExpr.Substring(strAvailExpr.Length - 1, 1) == "F" || strAvailExpr.Substring(strAvailExpr.Length - 1, 1) == "R")
					{
						strAvail = strAvailExpr.Substring(strAvailExpr.Length - 1, 1);
						// Remove the trailing character if it is "F" or "R".
						strAvailExpr = strAvailExpr.Substring(0, strAvailExpr.Length - 1);
					}
					XPathExpression xprAvail = nav.Compile(strAvailExpr.Replace("Rating", _intRating.ToString()));
					strCalculated = Convert.ToInt32(nav.Evaluate(xprAvail)).ToString() + strAvail;
				}
				else
				{
					// Just a straight cost, so return the value.
					string strAvail = "";
					if (_strAvail.Contains("F") || _strAvail.Contains("R"))
					{
						strAvail = _strAvail.Substring(_strAvail.Length - 1, 1);
						strCalculated = Convert.ToInt32(_strAvail.Substring(0, _strAvail.Length - 1)) + strAvail;
					}
					else
						strCalculated = Convert.ToInt32(_strAvail).ToString();
				}

				int intAvail = 0;
				string strAvailText = "";
				if (strCalculated.Contains("F") || strCalculated.Contains("R"))
				{
					strAvailText = strCalculated.Substring(strCalculated.Length - 1);
					intAvail = Convert.ToInt32(strCalculated.Replace(strAvailText, string.Empty));
				}
				else
					intAvail = Convert.ToInt32(strCalculated);

				strReturn = intAvail.ToString() + strAvailText;

				// Translate the Avail string.
				strReturn = strReturn.Replace("R", LanguageManager.Instance.GetString("String_AvailRestricted"));
				strReturn = strReturn.Replace("F", LanguageManager.Instance.GetString("String_AvailForbidden"));

				return strReturn;
			}
		}

		/// <summary>
		/// Total cost of the VehicleMod.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intReturn = 0;

				// If the cost is determined by the Rating, evaluate the expression.
				XmlDocument objXmlDocument = new XmlDocument();
				XPathNavigator nav = objXmlDocument.CreateNavigator();

				string strCost = "";
				string strCostExpression = "";
				strCostExpression = _strCost;

				strCost = strCostExpression.Replace("Rating", _intRating.ToString());
				strCost = strCost.Replace("Vehicle Cost", _intVehicleCost.ToString());
				// If the Body is 0 (Microdrone), treat it as 2 for the purposes of determine Modification cost.
				if (_intBody > 0)
					strCost = strCost.Replace("Body", _intBody.ToString());
				else
					strCost = strCost.Replace("Body", "2");
				strCost = strCost.Replace("Speed", _intSpeed.ToString());
				strCost = strCost.Replace("Accel(Running)", _intAccelRunning.ToString());
				strCost = strCost.Replace("Accel", _intAccelWalking.ToString());
				XPathExpression xprCost = nav.Compile(strCost);
				intReturn = Convert.ToInt32(nav.Evaluate(xprCost), GlobalOptions.Instance.CultureInfo);

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Retrieve the price of VehicleWeapons.
				foreach (Weapon objWeapon in _lstVehicleWeapons)
				{
					intReturn += objWeapon.TotalCost;
				}

				// Retrieve the price of Cyberware.
				foreach (Cyberware objCyberware in _lstCyberware)
					intReturn += objCyberware.TotalCost;

				return intReturn;
			}
		}

		/// <summary>
		/// The cost of just the Vehicle Mod itself.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intReturn = 0;

				// If the cost is determined by the Rating, evaluate the expression.
				XmlDocument objXmlDocument = new XmlDocument();
				XPathNavigator nav = objXmlDocument.CreateNavigator();

				string strCost = "";
				string strCostExpression = "";
				strCostExpression = _strCost;

				strCost = strCostExpression.Replace("Rating", _intRating.ToString());
				strCost = strCost.Replace("Vehicle Cost", _intVehicleCost.ToString());
				// If the Body is 0 (Microdrone), treat it as 2 for the purposes of determine Modification cost.
				if (_intBody > 0)
					strCost = strCost.Replace("Body", _intBody.ToString());
				else
					strCost = strCost.Replace("Body", "2");
				strCost = strCost.Replace("Speed", _intSpeed.ToString());
				strCost = strCost.Replace("Accel(Running)", _intAccelRunning.ToString());
				strCost = strCost.Replace("Accel", _intAccelWalking.ToString());
				XPathExpression xprCost = nav.Compile(strCost);
				intReturn = Convert.ToInt32(nav.Evaluate(xprCost).ToString());

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intReturn;
			}
		}

		/// <summary>
		/// The number of Slots the Mod consumes.
		/// </summary>
		public int CalculatedSlots
		{
			get
			{
				return Convert.ToInt32(_strSlots.Replace("Rating", _intRating.ToString()));
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
				if (_strAltName != string.Empty)
					strReturn = _strAltName;

				return strReturn;
			}
		}

		/// <summary>
		/// The name of the object as it should be displayed in lists. Qty Name (Rating) (Extra).
		/// </summary>
		public string DisplayName
		{
			get
			{
				string strReturn = DisplayNameShort;

				if (_strExtra != "")
					strReturn += " (" + LanguageManager.Instance.TranslateExtra(_strExtra) + ")";
				if (_intRating > 0)
					strReturn += " (" + LanguageManager.Instance.GetString("String_Rating") + " " + _intRating.ToString() + ")";
				return strReturn;
			}
		}

		/// <summary>
		/// Whether or not the Mod is allowed to accept Cyberware Modular Plugins.
		/// </summary>
		public bool AllowModularPlugins
		{
			get
			{
				bool blnReturn = false;
				foreach (Cyberware objChild in _lstCyberware)
				{
					if (objChild.Subsytems.Contains("Modular Plug-In"))
					{
						blnReturn = true;
						break;
					}
				}

				return blnReturn;
			}
		}
		#endregion
	}

	/// <summary>
	/// Vehicle.
	/// </summary>
	public class Vehicle
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private int _intHandling = 0;
		private string _strAccel = "";
		private int _intSpeed = 0;
		private int _intPilot = 0;
		private int _intBody = 0;
		private int _intArmor = 0;
		private int _intSensor = 0;
		private string _strAvail = "";
		private string _strCost = "";
		private string _strSource = "";
		private string _strPage = "";
		private string _strVehicleName = "";
		private int _intAddSlots = 0;
		private int _intDeviceRating = 3;
		private bool _blnHomeNode = false;
		private List<VehicleMod> _lstVehicleMods = new List<VehicleMod>();
		private List<Gear> _lstGear = new List<Gear>();
		private List<Weapon> _lstWeapons = new List<Weapon>();
		private string _strNotes = "";
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private List<string> _lstLocations = new List<string>();
		private bool _blnDiscountCost = false;

		private readonly Character _objCharacter;

		// Condition Monitor Progress.
		private int _intPhysicalCMFilled = 0;

		#region Constructor, Create, Save, Load, and Print Methods
		public Vehicle(Character objCharacter)
		{
			// Create the GUID for the new Vehicle.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Vehicle from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlVehicle">XmlNode of the Vehicle to create.</param>
		/// <param name="objNode">TreeNode to add to a TreeView.</param>
		/// <param name="cmsVehicle">ContextMenuStrip to attach to Weapon Mounts.</param>
		/// <param name="cmsVehicleGear">ContextMenuStrip to attach to Gear.</param>
		/// <param name="cmsVehicleWeapon">ContextMenuStrip to attach to Vehicle Weapons.</param>
		/// <param name="cmsVehicleWeaponAccessory">ContextMenuStrip to attach to Weapon Accessories.</param>
		/// <param name="cmsVehicleWeaponMod">ContextMenuStrip to attachk to Weapon Mods.</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		public void Create(XmlNode objXmlVehicle, TreeNode objNode, ContextMenuStrip cmsVehicle, ContextMenuStrip cmsVehicleGear, ContextMenuStrip cmsVehicleWeapon, ContextMenuStrip cmsVehicleWeaponAccessory, ContextMenuStrip cmsVehicleWeaponMod, bool blnCreateChildren = true)
		{
			_strName = objXmlVehicle["name"].InnerText;
			_strCategory = objXmlVehicle["category"].InnerText;
			_intHandling = Convert.ToInt32(objXmlVehicle["handling"].InnerText);
			_strAccel = objXmlVehicle["accel"].InnerText;
			_intSpeed = Convert.ToInt32(objXmlVehicle["speed"].InnerText);
			_intPilot = Convert.ToInt32(objXmlVehicle["pilot"].InnerText);
			_intBody = Convert.ToInt32(objXmlVehicle["body"].InnerText);
			_intArmor = Convert.ToInt32(objXmlVehicle["armor"].InnerText);
			_intSensor = Convert.ToInt32(objXmlVehicle["sensor"].InnerText);
			try
			{
				_intDeviceRating = Convert.ToInt32(objXmlVehicle["devicerating"].InnerText);
			}
			catch
			{
			}
			_strAvail = objXmlVehicle["avail"].InnerText;
			_strCost = objXmlVehicle["cost"].InnerText;
			_strSource = objXmlVehicle["source"].InnerText;
			_strPage = objXmlVehicle["page"].InnerText;

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("vehicles.xml");
				XmlNode objVehicleNode = objXmlDocument.SelectSingleNode("/chummer/vehicles/vehicle[name = \"" + _strName + "\"]");
				if (objVehicleNode != null)
				{
					if (objVehicleNode["translate"] != null)
						_strAltName = objVehicleNode["translate"].InnerText;
					if (objVehicleNode["altpage"] != null)
						_strAltPage = objVehicleNode["altpage"].InnerText;
				}

				objVehicleNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objVehicleNode != null)
				{
					if (objVehicleNode.Attributes["translate"] != null)
						_strAltCategory = objVehicleNode.Attributes["translate"].InnerText;
				}
			}

			objNode.Text = DisplayName;
			objNode.Tag = _guiID.ToString();

			// If there are any VehicleMods that come with the Vehicle, add them.
			if (objXmlVehicle.InnerXml.Contains("<mods>") && blnCreateChildren)
			{
				XmlDocument objXmlDocument = new XmlDocument();
				objXmlDocument = XmlManager.Instance.Load("vehicles.xml");

				XmlNodeList objXmlModList = objXmlVehicle.SelectNodes("mods/name");
				foreach (XmlNode objXmlVehicleMod in objXmlModList)
				{
					XmlNode objXmlMod = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + objXmlVehicleMod.InnerText + "\"]");
					TreeNode objModNode = new TreeNode();
					VehicleMod objMod = new VehicleMod(_objCharacter);
					int intRating = 0;

					if (objXmlVehicleMod.Attributes["rating"] != null)
						intRating = Convert.ToInt32(objXmlVehicleMod.Attributes["rating"].InnerText);

					if (objXmlVehicleMod.Attributes["select"] != null)
						objMod.Extra = objXmlVehicleMod.Attributes["select"].InnerText;

					objMod.Create(objXmlMod, objModNode, intRating);
					objMod.IncludedInVehicle = true;

					_lstVehicleMods.Add(objMod);
					objModNode.ForeColor = SystemColors.GrayText;
					objModNode.ContextMenuStrip = cmsVehicle;

					objNode.Nodes.Add(objModNode);
					objNode.Expand();
				}
				if (objXmlVehicle.SelectSingleNode("mods/addslots") != null)
					_intAddSlots = Convert.ToInt32(objXmlVehicle.SelectSingleNode("mods/addslots").InnerText);
			}

			// If there is any Gear that comes with the Vehicle, add them.
			if (objXmlVehicle.InnerXml.Contains("<gears>") && blnCreateChildren)
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("gear.xml");

				XmlNodeList objXmlGearList = objXmlVehicle.SelectNodes("gears/gear");
				foreach (XmlNode objXmlVehicleGear in objXmlGearList)
				{
					XmlNode objXmlGaer = objXmlDocument.SelectSingleNode("/chummer/gears/gear[name = \"" + objXmlVehicleGear.InnerText + "\"]");
					TreeNode objGearNode = new TreeNode();
					Gear objGear = new Gear(_objCharacter);
					int intRating = 0;
					int intQty = 1;
					string strForceValue = "";

					if (objXmlVehicleGear.Attributes["rating"] != null)
						intRating = Convert.ToInt32(objXmlVehicleGear.Attributes["rating"].InnerText);

					if (objXmlVehicleGear.Attributes["qty"] != null)
						intQty = Convert.ToInt32(objXmlVehicleGear.Attributes["qty"].InnerText);

					if (objXmlVehicleGear.Attributes["select"] != null)
						strForceValue = objXmlVehicleGear.Attributes["select"].InnerText;
					else
						strForceValue = "";

					List<Weapon> objWeapons = new List<Weapon>();
					List<TreeNode> objWeaponNodes = new List<TreeNode>();
					objGear.Create(objXmlGaer, _objCharacter, objGearNode, intRating, objWeapons, objWeaponNodes, strForceValue);
					objGear.Cost = "0";
					objGear.Quantity = intQty;
					objGear.MaxRating = objGear.Rating;
					objGearNode.Text = objGear.DisplayName;
					objGearNode.ContextMenuStrip = cmsVehicleGear;

					foreach (Weapon objWeapon in objWeapons)
						objWeapon.VehicleMounted = true;

					_lstGear.Add(objGear);

					objNode.Nodes.Add(objGearNode);
					objNode.Expand();
				}
			}

			// If there are any Weapons that come with the Vehicle, add them.
			if (objXmlVehicle.InnerXml.Contains("<weapons>") && blnCreateChildren)
			{
				XmlDocument objXmlWeaponDocument = XmlManager.Instance.Load("weapons.xml");

				foreach (XmlNode objXmlWeapon in objXmlVehicle.SelectNodes("weapons/weapon"))
				{
					bool blnAttached = false;
					TreeNode objWeaponNode = new TreeNode();
					Weapon objWeapon = new Weapon(_objCharacter);

					XmlNode objXmlWeaponNode = objXmlWeaponDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + objXmlWeapon["name"].InnerText + "\"]");
					objWeapon.Create(objXmlWeaponNode, _objCharacter, objWeaponNode, cmsVehicleWeapon, cmsVehicleWeaponAccessory, cmsVehicleWeaponMod);
					objWeapon.Cost = 0;
					objWeapon.VehicleMounted = true;

					// Find the first free Weapon Mount in the Vehicle.
					foreach (VehicleMod objMod in _lstVehicleMods)
					{
						if (objMod.Name.StartsWith("Weapon Mount") && objMod.Weapons.Count == 0)
						{
							objMod.Weapons.Add(objWeapon);
							foreach (TreeNode objModNode in objNode.Nodes)
							{
								if (objModNode.Tag.ToString() == objMod.InternalId)
								{
									objWeaponNode.ContextMenuStrip = cmsVehicleWeapon;
									objModNode.Nodes.Add(objWeaponNode);
									objModNode.Expand();
									blnAttached = true;
									break;
								}
							}
							break;
						}
					}

					// If a free Weapon Mount could not be found, just attach it to the first one found and let the player deal with it.
					if (!blnAttached)
					{
						foreach (VehicleMod objMod in _lstVehicleMods)
						{
							if (objMod.Name.StartsWith("Weapon Mount"))
							{
								objMod.Weapons.Add(objWeapon);
								foreach (TreeNode objModNode in objNode.Nodes)
								{
									if (objModNode.Tag.ToString() == objMod.InternalId)
									{
										objWeaponNode.ContextMenuStrip = cmsVehicleWeapon;
										objModNode.Nodes.Add(objWeaponNode);
										objModNode.Expand();
										blnAttached = true;
										break;
									}
								}
								break;
							}
						}
					}

					// Look for Weapon Accessories.
					if (objXmlWeapon["accessories"] != null)
					{
						foreach (XmlNode objXmlAccessory in objXmlWeapon.SelectNodes("accessories/accessory"))
						{
							XmlNode objXmlAccessoryNode = objXmlWeaponDocument.SelectSingleNode("/chummer/accessories/accessory[name = \"" + objXmlAccessory["name"].InnerText + "\"]");
							WeaponAccessory objMod = new WeaponAccessory(_objCharacter);
							TreeNode objModNode = new TreeNode();
							string strMount = "";
							if (objXmlAccessory["mount"] != null)
								strMount = objXmlAccessory["mount"].InnerText;
							objMod.Create(objXmlAccessoryNode, objModNode, strMount);
							objMod.Cost = "0";
							objModNode.ContextMenuStrip = cmsVehicleWeaponAccessory;

							objWeapon.WeaponAccessories.Add(objMod);

							objWeaponNode.Nodes.Add(objModNode);
							objWeaponNode.Expand();
						}
					}

					// Look for Weapon Mods.
					if (objXmlWeapon["mods"] != null)
					{
						foreach (XmlNode objXmlMod in objXmlWeapon.SelectNodes("mods/mod"))
						{
							XmlNode objXmlModNode = objXmlWeaponDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + objXmlMod["name"].InnerText + "\"]");
							WeaponMod objMod = new WeaponMod(_objCharacter);
							TreeNode objModNode = new TreeNode();
							objMod.Create(objXmlModNode, objModNode);
							objMod.Cost = "0";
							objModNode.ContextMenuStrip = cmsVehicleWeaponMod;

							objWeapon.WeaponMods.Add(objMod);

							objWeaponNode.Nodes.Add(objModNode);
							objWeaponNode.Expand();
						}
					}
				}
			}
		}

		/// <summary>
		/// Save the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Save(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("vehicle");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("handling", _intHandling.ToString());
			objWriter.WriteElementString("accel", _strAccel);
			objWriter.WriteElementString("speed", _intSpeed.ToString());
			objWriter.WriteElementString("pilot", _intPilot.ToString());
			objWriter.WriteElementString("body", _intBody.ToString());
			objWriter.WriteElementString("armor", _intArmor.ToString());
			objWriter.WriteElementString("sensor", _intSensor.ToString());
			objWriter.WriteElementString("devicerating", _intDeviceRating.ToString());
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _strCost);
			objWriter.WriteElementString("addslots", _intAddSlots.ToString());
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("physicalcmfilled", _intPhysicalCMFilled.ToString());
			objWriter.WriteElementString("vehiclename", _strVehicleName);
			objWriter.WriteElementString("homenode", _blnHomeNode.ToString());
			objWriter.WriteStartElement("mods");
			foreach (VehicleMod objMod in _lstVehicleMods)
				objMod.Save(objWriter);
			objWriter.WriteEndElement();
			objWriter.WriteStartElement("gears");
			foreach (Gear objGear in _lstGear)
			{
				// Use the Gear's SubClass if applicable.
				if (objGear.GetType() == typeof(Commlink))
				{
					Commlink objCommlink = new Commlink(_objCharacter);
					objCommlink = (Commlink)objGear;
					objCommlink.Save(objWriter);
				}
				else if (objGear.GetType() == typeof(OperatingSystem))
				{
					OperatingSystem objOperatinSystem = new OperatingSystem(_objCharacter);
					objOperatinSystem = (OperatingSystem)objGear;
					objOperatinSystem.Save(objWriter);
				}
				else
				{
					objGear.Save(objWriter);
				}
			}
			objWriter.WriteEndElement();
			objWriter.WriteStartElement("weapons");
			foreach (Weapon objWeapon in _lstWeapons)
				objWeapon.Save(objWriter);
			objWriter.WriteEndElement();
			objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteElementString("discountedcost", DiscountCost.ToString());
			if (_lstLocations.Count > 0)
			{
				// <locations>
				objWriter.WriteStartElement("locations");
				foreach (string strLocation in _lstLocations)
				{
					objWriter.WriteElementString("location", strLocation);
				}
				// </locations>
				objWriter.WriteEndElement();
			}
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the Vehicle from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode, bool blnCopy = false)
		{
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strCategory = objNode["category"].InnerText;
			_intHandling = Convert.ToInt32(objNode["handling"].InnerText);
			_strAccel = objNode["accel"].InnerText;
			_intSpeed = Convert.ToInt32(objNode["speed"].InnerText);
			_intPilot = Convert.ToInt32(objNode["pilot"].InnerText);
			_intBody = Convert.ToInt32(objNode["body"].InnerText);
			_intArmor = Convert.ToInt32(objNode["armor"].InnerText);
			_intSensor = Convert.ToInt32(objNode["sensor"].InnerText);
			try
			{
				_intDeviceRating = Convert.ToInt32(objNode["devicerating"].InnerText);
			}
			catch
			{
			}
			_strAvail = objNode["avail"].InnerText;
			_strCost = objNode["cost"].InnerText;
			try
			{
				_intAddSlots = Convert.ToInt32(objNode["addslots"].InnerText);
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
				_intPhysicalCMFilled = Convert.ToInt32(objNode["physicalcmfilled"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strVehicleName = objNode["vehiclename"].InnerText;
			}
			catch
			{
			}
			try
			{
				_blnHomeNode = Convert.ToBoolean(objNode["homenode"].InnerText);
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("vehicles.xml");
				XmlNode objVehicleNode = objXmlDocument.SelectSingleNode("/chummer/vehicles/vehicle[name = \"" + _strName + "\"]");
				if (objVehicleNode != null)
				{
					if (objVehicleNode["translate"] != null)
						_strAltName = objVehicleNode["translate"].InnerText;
					if (objVehicleNode["altpage"] != null)
						_strAltPage = objVehicleNode["altpage"].InnerText;
				}

				objVehicleNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objVehicleNode != null)
				{
					if (objVehicleNode.Attributes["translate"] != null)
						_strAltCategory = objVehicleNode.Attributes["translate"].InnerText;
				}
			}

			if (objNode.InnerXml.Contains("<mods>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("mods/mod");
				foreach (XmlNode nodChild in nodChildren)
				{
					VehicleMod objMod = new VehicleMod(_objCharacter);
					objMod.Load(nodChild, blnCopy);
					_lstVehicleMods.Add(objMod);
				}
			}

			if (objNode.InnerXml.Contains("<gears>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("gears/gear");
				foreach (XmlNode nodChild in nodChildren)
				{
					switch (nodChild["category"].InnerText)
					{
						case "Commlink":
						case "Commlink Upgrade":
							Commlink objCommlink = new Commlink(_objCharacter);
							objCommlink.Load(nodChild, blnCopy);
							_lstGear.Add(objCommlink);
							break;
						case "Commlink Operating System":
						case "Commlink Operating System Upgrade":
							OperatingSystem objOperatingSystem = new OperatingSystem(_objCharacter);
							objOperatingSystem.Load(nodChild, blnCopy);
							_lstGear.Add(objOperatingSystem);
							break;
						default:
							Gear objGear = new Gear(_objCharacter);
							objGear.Load(nodChild, blnCopy);
							_lstGear.Add(objGear);
							break;
					}
				}
			}

			if (objNode.InnerXml.Contains("<weapons>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("weapons/weapon");
				foreach (XmlNode nodChild in nodChildren)
				{
					Weapon objWeapon = new Weapon(_objCharacter);
					objWeapon.Load(nodChild, blnCopy);
					objWeapon.VehicleMounted = true;
					if (objWeapon.UnderbarrelWeapons.Count > 0)
					{
						foreach (Weapon objUnderbarrel in objWeapon.UnderbarrelWeapons)
							objUnderbarrel.VehicleMounted = true;
					}
					_lstWeapons.Add(objWeapon);
				}
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
				_blnDiscountCost = Convert.ToBoolean(objNode["discountedcost"].InnerText);
			}
			catch
			{
			}

			if (objNode["locations"] != null)
			{
				// Locations.
				foreach (XmlNode objXmlLocation in objNode.SelectNodes("locations/location"))
				{
					_lstLocations.Add(objXmlLocation.InnerText);
				}
			}

			if (blnCopy)
			{
				_guiID = Guid.NewGuid();
				_blnHomeNode = false;
			}
		}

		/// <summary>
		/// Print the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Print(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("vehicle");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("handling", TotalHandling.ToString());
			objWriter.WriteElementString("accel", TotalAccel);
			objWriter.WriteElementString("speed", TotalSpeed.ToString());
			objWriter.WriteElementString("pilot", Pilot.ToString());
			objWriter.WriteElementString("body", TotalBody.ToString());
			objWriter.WriteElementString("armor", TotalArmor.ToString());
			if (_objCharacter.Options.UseCalculatedVehicleSensorRatings)
				objWriter.WriteElementString("sensor", CalculatedSensor.ToString());
			else
				objWriter.WriteElementString("sensor", _intSensor.ToString());
			objWriter.WriteElementString("sensorsignal", SensorSignal.ToString());
			objWriter.WriteElementString("avail", CalculatedAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("physicalcm", PhysicalCM.ToString());
			objWriter.WriteElementString("physicalcmfilled", _intPhysicalCMFilled.ToString());
			objWriter.WriteElementString("vehiclename", _strVehicleName);
			objWriter.WriteElementString("firewall", Firewall.ToString());
			objWriter.WriteElementString("signal", Signal.ToString());
			objWriter.WriteElementString("response", Response.ToString());
			objWriter.WriteElementString("system", System.ToString());
			objWriter.WriteElementString("devicerating", DeviceRating.ToString());
			objWriter.WriteElementString("maneuver", Maneuver.ToString());
			objWriter.WriteElementString("homenode", _blnHomeNode.ToString());
			objWriter.WriteStartElement("mods");
			foreach (VehicleMod objMod in _lstVehicleMods)
				objMod.Print(objWriter);
			objWriter.WriteEndElement();
			objWriter.WriteStartElement("gears");
			foreach (Gear objGear in _lstGear)
			{
				// Use the Gear's SubClass if applicable.
				if (objGear.GetType() == typeof(Commlink))
				{
					Commlink objCommlink = new Commlink(_objCharacter);
					objCommlink = (Commlink)objGear;
					objCommlink.Print(objWriter);
				}
				else if (objGear.GetType() == typeof(OperatingSystem))
				{
					OperatingSystem objOperatinSystem = new OperatingSystem(_objCharacter);
					objOperatinSystem = (OperatingSystem)objGear;
					objOperatinSystem.Print(objWriter);
				}
				else
				{
					objGear.Print(objWriter);
				}
			}
			objWriter.WriteEndElement();
			objWriter.WriteStartElement("weapons");
			foreach (Weapon objWeapon in _lstWeapons)
				objWeapon.Print(objWriter);
			objWriter.WriteEndElement();
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this piece of Gear in the Character.
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
		/// Translated Category.
		/// </summary>
		public string DisplayCategory
		{
			get
			{
				string strReturn = _strCategory;
				if (_strAltCategory != string.Empty)
					strReturn = _strAltCategory;

				return strReturn;
			}
		}

		/// <summary>
		/// Category.
		/// </summary>
		public string Category
		{
			get
			{
				return _strCategory;
			}
			set
			{
				_strCategory = value;
			}
		}

		/// <summary>
		/// Handling.
		/// </summary>
		public int Handling
		{
			get
			{
				return _intHandling;
			}
			set
			{
				_intHandling = value;
			}
		}

		/// <summary>
		/// Acceleration.
		/// </summary>
		public string Accel
		{
			get
			{
				return _strAccel;
			}
			set
			{
				_strAccel = value;
			}
		}

		/// <summary>
		/// Speed.
		/// </summary>
		public int Speed
		{
			get
			{
				return _intSpeed;
			}
			set
			{
				_intSpeed = value;
			}
		}

		/// <summary>
		/// Pilot.
		/// </summary>
		public int Pilot
		{
			get
			{
				int intReturn = _intPilot;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.Pilot > intReturn && objMod.Installed)
						intReturn = objMod.Pilot;
				}
				return intReturn;
			}
			set
			{
				_intPilot = value;
			}
		}

		/// <summary>
		/// Body.
		/// </summary>
		public int Body
		{
			get
			{
				return _intBody;
			}
			set
			{
				_intBody = value;
			}
		}

		/// <summary>
		/// Armor.
		/// </summary>
		public int Armor
		{
			get
			{
				return _intArmor;
			}
			set
			{
				_intArmor = value;
			}
		}

		/// <summary>
		/// Sensor.
		/// </summary>
		public int Sensor
		{
			get
			{
				return _intSensor;
			}
			set
			{
				_intSensor = value;
			}
		}

		/// <summary>
		/// Device Rating.
		/// </summary>
		public int DeviceRating
		{
			get
			{
				int intDeviceRating = _intDeviceRating;

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.Bonus != null)
					{
						// Add the Modification's Device Rating to the Vehicle's base Device Rating.
						if (objMod.Bonus.InnerXml.Contains("<devicerating>"))
							intDeviceRating += Convert.ToInt32(objMod.Bonus["devicerating"].InnerText);
					}
				}

				// Device Rating cannot go below 1.
				if (intDeviceRating < 1)
					intDeviceRating = 1;

				return intDeviceRating;
			}
			set
			{
				_intDeviceRating = value;
			}
		}

		/// <summary>
		/// Physical Condition Monitor boxes.
		/// </summary>
		public int PhysicalCM
		{
			get
			{
				return 8 + Convert.ToInt32(Math.Ceiling(Convert.ToDouble(_intBody, GlobalOptions.Instance.CultureInfo) / 2.0));
			}
		}

		/// <summary>
		/// Physical Condition Monitor boxes filled.
		/// </summary>
		public int PhysicalCMFilled
		{
			get
			{
				return _intPhysicalCMFilled;
			}
			set
			{
				_intPhysicalCMFilled = value;
			}
		}

		/// <summary>
		/// Availability.
		/// </summary>
		public string Avail
		{
			get
			{
				return _strAvail;
			}
			set
			{
				_strAvail = value;
			}
		}

		/// <summary>
		/// Cost.
		/// </summary>
		public string Cost
		{
			get
			{
				return _strCost;
			}
			set
			{
				_strCost = value;
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
				if (_strAltPage != string.Empty)
					strReturn = _strAltPage;

				return strReturn;
			}
			set
			{
				_strPage = value;
			}
		}

		/// <summary>
		/// Vehicle Modifications applied to the Vehicle.
		/// </summary>
		public List<VehicleMod> Mods
		{
			get
			{
				return _lstVehicleMods;
			}
		}

		/// <summary>
		/// Gear applied to the Vehicle.
		/// </summary>
		public List<Gear> Gear
		{
			get
			{
				return _lstGear;
			}
		}

		/// <summary>
		/// Weapons applied to the Vehicle through Gear.
		/// </summary>
		public List<Weapon> Weapons
		{
			get
			{
				return _lstWeapons;
			}
		}

		/// <summary>
		/// Calculated Availablility of the Vehicle.
		/// </summary>
		public string CalculatedAvail
		{
			get
			{
				string strReturn = _strAvail;

				// Translate the Avail string.
				strReturn = strReturn.Replace("R", LanguageManager.Instance.GetString("String_AvailRestricted"));
				strReturn = strReturn.Replace("F", LanguageManager.Instance.GetString("String_AvailForbidden"));

				return strReturn;
			}
		}

		/// <summary>
		/// Acceleration "Walking" speed (first number of the set).
		/// </summary>
		public int AccelWalking
		{
			get
			{
				string[] strAccel = _strAccel.Split('/');
				return Convert.ToInt32(strAccel[0]);
			}
		}

		/// <summary>
		/// Acceleration "Running" speed (second number of the set).
		/// </summary>
		public int AccelRunning
		{
			get
			{
				string[] strAccel = _strAccel.Split('/');
				return Convert.ToInt32(strAccel[1]);
			}
		}

		/// <summary>
		/// Number of Slots the Vehicle has for Modifications.
		/// </summary>
		public int Slots
		{
			get
			{
				// A Vehicle has 4 or BODY slots, whichever is higher.
				if (TotalBody > 4)
					return TotalBody + _intAddSlots;
				else
					return 4 + _intAddSlots;
			}
		}

		/// <summary>
		/// Response.
		/// </summary>
		public int Response
		{
			get
			{
				int intReturn = _intDeviceRating;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.Response > intReturn && objMod.Installed)
						intReturn = objMod.Response;
				}

				// Adjust the stat to include the A.I.'s Home Node bonus.
				if (_blnHomeNode)
				{
					decimal decBonus = Math.Ceiling(_objCharacter.INT.TotalValue / 2m);
					int intBonus = Convert.ToInt32(decBonus, GlobalOptions.Instance.CultureInfo);
					intReturn += intBonus;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// System.
		/// </summary>
		public int System
		{
			get
			{
				int intReturn = _intDeviceRating;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.System > intReturn && objMod.Installed)
						intReturn = objMod.System;
				}

				// Adjust the stat to include the A.I.'s Home Node bonus.
				if (_blnHomeNode)
				{
					decimal decBonus = Math.Ceiling(_objCharacter.LOG.TotalValue / 2m);
					int intBonus = Convert.ToInt32(decBonus, GlobalOptions.Instance.CultureInfo);
					intReturn += intBonus;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Firewall.
		/// </summary>
		public int Firewall
		{
			get
			{
				int intReturn = _intDeviceRating;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.Firewall > intReturn && objMod.Installed)
						intReturn = objMod.Firewall;
				}

				// Adjust the stat to include the A.I.'s Home Node bonus.
				if (_blnHomeNode)
				{
					decimal decBonus = Math.Ceiling(_objCharacter.WIL.TotalValue / 2m);
					int intBonus = Convert.ToInt32(decBonus, GlobalOptions.Instance.CultureInfo);
					intReturn += intBonus;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Signal.
		/// </summary>
		public int Signal
		{
			get
			{
				int intReturn = _intDeviceRating;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (objMod.Signal > intReturn && objMod.Installed)
						intReturn = objMod.Signal;
				}

				// Adjust the stat to include the A.I.'s Home Node bonus.
				if (_blnHomeNode)
				{
					decimal decBonus = Math.Ceiling(_objCharacter.CHA.TotalValue / 2m);
					int intBonus = Convert.ToInt32(decBonus, GlobalOptions.Instance.CultureInfo);
					intReturn += intBonus;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Sensor's Signal.
		/// </summary>
		public int SensorSignal
		{
			get
			{
				int intReturn = 0;
				foreach (Gear objGear in _lstGear)
				{
					if (objGear.Category == "Sensors" && objGear.Signal > 0 && objGear.Signal > intReturn)
						intReturn = objGear.Signal;
				}
				return intReturn;
			}
		}

		/// <summary>
		/// Calculate the Vehicle's Sensor Rating based on the items within its Sensor.
		/// </summary>
		public int CalculatedSensor
		{
			get
			{
				int intReturn = 0;
				int intCount = 0;
				foreach (Gear objGear in _lstGear)
				{
					if (objGear.Category == "Sensors" && objGear.Signal > 0)
					{
						foreach (Gear objChild in objGear.Children)
						{
							if (objChild.Category == "Sensor Functions")
							{
								if (objChild.Rating > 0)
								{
									intCount++;
									intReturn += objChild.Rating;
								}
							}
						}
					}
					break;
				}

				if (intCount > 0)
				{
					decimal decReturn = Convert.ToDecimal(intReturn, GlobalOptions.Instance.CultureInfo);
					intReturn = Convert.ToInt32(Math.Ceiling(decReturn / intCount));
				}
				else
					intReturn = _intSensor;

				return intReturn;
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
		/// A custom name for the Vehicle assigned by the player.
		/// </summary>
		public string VehicleName
		{
			get
			{
				return _strVehicleName;
			}
			set
			{
				_strVehicleName = value;
			}
		}

		/// <summary>
		/// The name of the object as it should appear on printouts (translated name only).
		/// </summary>
		public string DisplayNameShort
		{
			get
			{
				string strReturn = _strName;
				if (_strAltName != string.Empty)
					strReturn = _strAltName;

				return strReturn;
			}
		}

		/// <summary>
		/// Display name.
		/// </summary>
		public string DisplayName
		{
			get
			{
				string strReturn = DisplayNameShort;

				if (_strVehicleName != "")
				{
					strReturn += " (\"" + _strVehicleName + "\")";
				}

				return strReturn;
			}
		}

		/// <summary>
		/// Whether or not the Vehicle is an A.I.'s Home Node.
		/// </summary>
		public bool HomeNode
		{
			get
			{
				return _blnHomeNode;
			}
			set
			{
				_blnHomeNode = value;
			}
		}

		/// <summary>
		/// Locations.
		/// </summary>
		public List<string> Locations
		{
			get
			{
				return _lstLocations;
			}
		}

		/// <summary>
		/// Whether or not the Armor's cost should be discounted by 10% through the Black Market Pipeline Quality.
		/// </summary>
		public bool DiscountCost
		{
			get
			{
				if (_objCharacter.Created)
					return false;
				else
					return _blnDiscountCost;
			}
			set
			{
				_blnDiscountCost = value;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// The number of Slots on the Vehicle that are used by Mods.
		/// </summary>
		public int SlotsUsed
		{
			get
			{
				int intSlotsUsed = 0;
				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					// Mods that are included with a Vehicle by default do not count toward the Slots used.
					if (!objMod.IncludedInVehicle && objMod.Installed)
						intSlotsUsed += objMod.CalculatedSlots;
				}

				return intSlotsUsed;
			}
		}

		/// <summary>
		/// Total cost of the Vehicle including all after-market Modification.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intCost = Convert.ToInt32(_strCost);

				if (DiscountCost)
					intCost = Convert.ToInt32(Convert.ToDouble(intCost, GlobalOptions.Instance.CultureInfo) * 0.9);

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					// Do not include the price of Mods that are part of the base configureation.
					if (!objMod.IncludedInVehicle)
					{
						objMod.VehicleCost = Convert.ToInt32(_strCost);
						objMod.Body = _intBody;
						objMod.Speed = _intSpeed;
						objMod.AccelRunning = AccelRunning;
						objMod.AccelWalking = AccelWalking;

						intCost += objMod.TotalCost;
					}
					else
					{
						// If the Mod is a part of the base config, check the items attached to it since their cost still counts.
						foreach (Weapon objWeapon in objMod.Weapons)
							intCost += objWeapon.TotalCost;
						foreach (Cyberware objCyberware in objMod.Cyberware)
							intCost += objCyberware.TotalCost;
					}
				}

				foreach (Gear objGear in _lstGear)
				{
					intCost += objGear.TotalCost;
				}

				return intCost;
			}
		}

		/// <summary>
		/// The cost of just the Vehicle itself.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intCost = Convert.ToInt32(_strCost);

				if (DiscountCost)
					intCost = Convert.ToInt32(Convert.ToDouble(intCost, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intCost;
			}
		}

		/// <summary>
		/// Total Speed of the Vehicle including Modifications.
		/// </summary>
		public int TotalSpeed
		{
			get
			{
				decimal decSpeed = Convert.ToDecimal(_intSpeed, GlobalOptions.Instance.CultureInfo);

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (!objMod.IncludedInVehicle && objMod.Installed && objMod.Bonus != null)
					{
						// Multiply the Vehicle's base Speed by the Modification's Speed multiplier.
						if (objMod.Bonus.InnerXml.Contains("<speed>"))
							decSpeed += (Convert.ToDecimal(_intSpeed, GlobalOptions.Instance.CultureInfo) * Convert.ToDecimal(objMod.Bonus["speed"].InnerText, GlobalOptions.Instance.CultureInfo));
					}
				}

				// If the Vehicle's Total Armor exceeds its Total Body, Accel and Speed are decreased by 20%.
				// The value must also exceed the Armor Rating that the Vehicles comes equipped with by default.
				if (TotalArmor > TotalBody && TotalArmor > _intArmor)
				{
					decSpeed -= (Convert.ToDecimal(_intSpeed, GlobalOptions.Instance.CultureInfo) * 0.2m);
				}

				// Make sure Speed doesn't go below 0.
				if (decSpeed < 0.0m)
					decSpeed = 0.0m;

				return Convert.ToInt32(Math.Ceiling(decSpeed));
			}
		}

		/// <summary>
		/// Total Accel of the Vehicle including Modifications.
		/// </summary>
		public string TotalAccel
		{
			get
			{
				decimal decAccelWalking = Convert.ToDecimal(AccelWalking, GlobalOptions.Instance.CultureInfo);
				decimal decAccelRunning = Convert.ToDecimal(AccelRunning, GlobalOptions.Instance.CultureInfo);

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (!objMod.IncludedInVehicle && objMod.Installed && objMod.Bonus != null)
					{
						// Multiply the Vehicle's base Accel by the Modification's Accel multiplier.
						if (objMod.Bonus.InnerXml.Contains("<accel>"))
						{
							if (objMod.Bonus["accel"].InnerText.Contains("+"))
							{
								string[] strAccel = objMod.Bonus["accel"].InnerText.Split('/');

								XmlDocument objXmlDocument = new XmlDocument();
								XPathNavigator nav = objXmlDocument.CreateNavigator();

								XPathExpression xprWalking = nav.Compile(strAccel[0].Replace("Rating", objMod.Rating.ToString()).Replace("+", string.Empty));
								XPathExpression xprRunning = nav.Compile(strAccel[1].Replace("Rating", objMod.Rating.ToString()).Replace("+", string.Empty));

								decAccelWalking += Convert.ToDecimal(nav.Evaluate(xprWalking), GlobalOptions.Instance.CultureInfo);
								decAccelRunning += Convert.ToDecimal(nav.Evaluate(xprRunning), GlobalOptions.Instance.CultureInfo);
							}
							else
							{
								decAccelWalking += (Convert.ToDecimal(AccelWalking, GlobalOptions.Instance.CultureInfo) * Convert.ToDecimal(objMod.Bonus["accel"].InnerText, GlobalOptions.Instance.CultureInfo));
								decAccelRunning += (Convert.ToDecimal(AccelRunning, GlobalOptions.Instance.CultureInfo) * Convert.ToDecimal(objMod.Bonus["accel"].InnerText, GlobalOptions.Instance.CultureInfo));
							}
						}
					}
				}

				// If the Vehicle's Total Armor exceeds its Total Body, Accel and Speed are decreased by 20%.
				// The value must also exceed the Armor Rating that the Vehicles comes equipped with by default.
				if (TotalArmor > TotalBody && TotalArmor > _intArmor)
				{
					decAccelWalking -= (Convert.ToDecimal(AccelWalking, GlobalOptions.Instance.CultureInfo) * 0.2m);
					decAccelRunning -= (Convert.ToDecimal(AccelRunning, GlobalOptions.Instance.CultureInfo) * 0.2m);
				}

				// Make sure Acceleration doesn't go below 0.
				if (decAccelWalking < 0.0m)
					decAccelWalking = 0.0m;
				if (decAccelRunning < 0.0m)
					decAccelRunning = 0.0m;

				return Convert.ToInt32(Math.Ceiling(decAccelWalking)).ToString() + "/" + Convert.ToInt32(Math.Ceiling(decAccelRunning)).ToString();
			}
		}

		/// <summary>
		/// Total Body of the Vehicle including Modifications.
		/// </summary>
		public int TotalBody
		{
			get
			{
				int intBody = _intBody;

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (!objMod.IncludedInVehicle && objMod.Installed && objMod.Bonus != null)
					{
						// Add the Modification's Body to the Vehicle's base Body.
						if (objMod.Bonus.InnerXml.Contains("<body>"))
							intBody += Convert.ToInt32(objMod.Bonus["body"].InnerText);
					}
				}

				return intBody;
			}
		}

		/// <summary>
		/// Total Handling of the Vehicle including Modifications.
		/// </summary>
		public int TotalHandling
		{
			get
			{
				int intHandling = _intHandling;

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (!objMod.IncludedInVehicle && objMod.Installed && objMod.Bonus != null)
					{
						// Add the Modification's Handling to the Vehicle's base Handling.
						if (objMod.Bonus.InnerXml.Contains("<handling>"))
							intHandling += Convert.ToInt32(objMod.Bonus["handling"].InnerText);
					}
				}

				return intHandling;
			}
		}

		/// <summary>
		/// Total Armor of the Vehicle including Modifications.
		/// </summary>
		public int TotalArmor
		{
			get
			{
				int intBaseArmor = _intArmor;
				int intModArmor = 0;

				foreach (VehicleMod objMod in _lstVehicleMods)
				{
					if (!objMod.IncludedInVehicle && objMod.Installed && objMod.Bonus != null)
					{
						// Add the Modification's Armor to the Vehicle's base Armor. Armor provided by Mods strips the Vehicle of its base Armor.
						if (objMod.Bonus.InnerXml.Contains("<armor>"))
						{
							intBaseArmor = 0;
							intModArmor += Math.Min(MaxArmor, Convert.ToInt32(objMod.Bonus["armor"].InnerText.Replace("Rating", objMod.Rating.ToString())));
						}
					}
				}

				return intBaseArmor + intModArmor;
			}
		}

		/// <summary>
		/// Maximum amount of each Armor type the Vehicle can hold.
		/// </summary>
		public int MaxArmor
		{
			get
			{
				int intReturn = 0;
				int intMultiplier = 2;

				// Drones are allowed up to Body x 3 Armor.
				if (_strCategory.StartsWith("Drones:"))
					intMultiplier = 3;

				intReturn = TotalBody * intMultiplier;

				// If ignoring the rules, do not limit Armor to the Vehicle's standard rules.
				if (_objCharacter.IgnoreRules)
					intReturn = 20;

				return intReturn;
			}
		}

		/// <summary>
		/// Vehicle's Maneuver AutoSoft Rating.
		/// </summary>
		public int Maneuver
		{
			get
			{
				int intReturn = 0;
				Gear objGear = FindGearByName("Maneuver", _lstGear);
				if (objGear != null)
				{
					intReturn = objGear.Rating;
				}

				return intReturn;
			}
		}
		#endregion

		#region Methods
		/// <summary>
		/// Whether or not the Vehicle has the Modular Electronics Vehicle Modification installed.
		/// </summary>
		public bool HasModularElectronics()
		{
			bool blnReturn = false;
			foreach (VehicleMod objMod in _lstVehicleMods)
			{
				if (objMod.Name == "Modular Electronics")
				{
					blnReturn = true;
					break;
				}
			}
			return blnReturn;
		}

		/// <summary>
		/// Locate a piece of Gear.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstGear">List of Gear to search.</param>
		private Gear FindGear(string strGuid, List<Gear> lstGear)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Gear objGear in lstGear)
			{
				if (objGear.InternalId == strGuid)
					objReturn = objGear;
				else
				{
					if (objGear.Children.Count > 0)
						objReturn = FindGear(strGuid, objGear.Children);
				}

				if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
					return objReturn;
			}

			return objReturn;
		}

		/// <summary>
		/// Locate a piece of Gear.
		/// </summary>
		/// <param name="strName">Name of the Gear to find.</param>
		/// <param name="lstGear">List of Gear to search.</param>
		private Gear FindGearByName(string strName, List<Gear> lstGear)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Gear objGear in lstGear)
			{
				if (objGear.Name == strName)
					objReturn = objGear;
				else
				{
					if (objGear.Children.Count > 0)
						objReturn = FindGearByName(strName, objGear.Children);
				}

				if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
					return objReturn;
			}

			return objReturn;
		}
		#endregion
	}
}