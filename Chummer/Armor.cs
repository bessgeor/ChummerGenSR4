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
	/// Capacity Style.
	/// </summary>
	public enum CapacityStyle
	{
		Zero = 0,
		Standard = 1,
		PerRating = 2,
	}

	/// <summary>
	/// A piece of Armor Modification.
	/// </summary>
	public class ArmorMod
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private string _strArmorCapacity = "[0]";
		private int _intB = 0;
		private int _intI = 0;
		private int _intMaxRating = 0;
		private int _intRating = 0;
		private string _strAvail = "";
		private string _strCost = "";
		private string _strSource = "";
		private string _strPage = "";
		private bool _blnIncludedInArmor = false;
		private bool _blnEquipped = true;
		private string _strExtra = "";
		private Guid _guiWeaponID = new Guid();
		private XmlNode _nodBonus;
		private readonly Character _objCharacter;
		private string _strNotes = "";
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private bool _blnDiscountCost = false;
		private Armor _objParent;

		#region Constructor, Create, Save, Load, and Print Methods
		public ArmorMod(Character objCharacter)
		{
			// Create the GUID for the new Armor Mod.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Armor Modification from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlArmorNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="intRating">Rating of the selected ArmorMod.</param>
		/// <param name="objWeapons">List of Weapons that are created by the Armor.</param>
		/// <param name="objWeaponNodes">List of Weapon Nodes that are created by the Armor.</param>
		/// <param name="blnSkipCost">Whether or not creating the Armor should skip the Variable price dialogue (should only be used by frmSelectArmor).</param>
		public void Create(XmlNode objXmlArmorNode, TreeNode objNode, int intRating, List<Weapon> objWeapons, List<TreeNode> objWeaponNodes, bool blnSkipCost = false)
		{
			_strName = objXmlArmorNode["name"].InnerText;
			_strCategory = objXmlArmorNode["category"].InnerText;
			_strArmorCapacity = objXmlArmorNode["armorcapacity"].InnerText;
			_intB = Convert.ToInt32(objXmlArmorNode["b"].InnerText);
			_intI = Convert.ToInt32(objXmlArmorNode["i"].InnerText);
			_intRating = intRating;
			_intMaxRating = Convert.ToInt32(objXmlArmorNode["maxrating"].InnerText);
			_strAvail = objXmlArmorNode["avail"].InnerText;
			_strCost = objXmlArmorNode["cost"].InnerText;
			_strSource = objXmlArmorNode["source"].InnerText;
			_strPage = objXmlArmorNode["page"].InnerText;
			_nodBonus = objXmlArmorNode["bonus"];

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("armor.xml");
				XmlNode objArmorNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode["translate"] != null)
						_strAltName = objArmorNode["translate"].InnerText;
					if (objArmorNode["altpage"] != null)
						_strAltPage = objArmorNode["altpage"].InnerText;
				}

				objArmorNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode.Attributes["translate"] != null)
						_strAltCategory = objArmorNode.Attributes["translate"].InnerText;
				}
			}

			if (objXmlArmorNode["bonus"] != null && !blnSkipCost)
			{
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				if (!objImprovementManager.CreateImprovements(Improvement.ImprovementSource.ArmorMod, _guiID.ToString(), objXmlArmorNode["bonus"], false, intRating, DisplayNameShort))
				{
					_guiID = Guid.Empty;
					return;
				}
				if (objImprovementManager.SelectedValue != "")
				{
					_strExtra = objImprovementManager.SelectedValue;
					objNode.Text += " (" + objImprovementManager.SelectedValue + ")";
				}
			}

			// Add Weapons if applicable.
			if (objXmlArmorNode.InnerXml.Contains("<addweapon>"))
			{
				XmlDocument objXmlWeaponDocument = XmlManager.Instance.Load("weapons.xml");

				// More than one Weapon can be added, so loop through all occurrences.
				foreach (XmlNode objXmlAddWeapon in objXmlArmorNode.SelectNodes("addweapon"))
				{
					XmlNode objXmlWeapon = objXmlWeaponDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + objXmlAddWeapon.InnerText + "\" and starts-with(category, \"Cyberware\")]");

					TreeNode objGearWeaponNode = new TreeNode();
					Weapon objGearWeapon = new Weapon(_objCharacter);
					objGearWeapon.Create(objXmlWeapon, _objCharacter, objGearWeaponNode, null, null, null);
					objGearWeaponNode.ForeColor = SystemColors.GrayText;
					objWeaponNodes.Add(objGearWeaponNode);
					objWeapons.Add(objGearWeapon);

					_guiWeaponID = Guid.Parse(objGearWeapon.InternalId);
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
			objWriter.WriteStartElement("armormod");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("b", _intB.ToString());
			objWriter.WriteElementString("i", _intI.ToString());
			objWriter.WriteElementString("armorcapacity", _strArmorCapacity);
			objWriter.WriteElementString("maxrating", _intMaxRating.ToString());
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _strCost);
			if (_nodBonus != null)
				objWriter.WriteRaw(_nodBonus.OuterXml);
			else
				objWriter.WriteElementString("bonus", "");
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("included", _blnIncludedInArmor.ToString());
			objWriter.WriteElementString("equipped", _blnEquipped.ToString());
			objWriter.WriteElementString("extra", _strExtra);
			if (_guiWeaponID != Guid.Empty)
				objWriter.WriteElementString("weaponguid", _guiWeaponID.ToString());
			objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteElementString("discountedcost", DiscountCost.ToString());
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the Attribute from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode, bool blnCopy = false)
		{
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strCategory = objNode["category"].InnerText;
			_intB = Convert.ToInt32(objNode["b"].InnerText);
			_intI = Convert.ToInt32(objNode["i"].InnerText);
			try
			{
				_strArmorCapacity = objNode["armorcapacity"].InnerText;
			}
			catch
			{
			}
			_intMaxRating = Convert.ToInt32(objNode["maxrating"].InnerText);
			_intRating = Convert.ToInt32(objNode["rating"].InnerText);
			_strAvail = objNode["avail"].InnerText;
			_strCost = objNode["cost"].InnerText;
			try
			{
				_nodBonus = objNode["bonus"];
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
				_blnIncludedInArmor = Convert.ToBoolean(objNode["included"].InnerText);
			}
			catch
			{
			}
			try
			{
				_blnEquipped = Convert.ToBoolean(objNode["equipped"].InnerText);
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
			try
			{
				_guiWeaponID = Guid.Parse(objNode["weaponguid"].InnerText);
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

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("armor.xml");
				XmlNode objArmorNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode["translate"] != null)
						_strAltName = objArmorNode["translate"].InnerText;
					if (objArmorNode["altpage"] != null)
						_strAltPage = objArmorNode["altpage"].InnerText;
				}

				objArmorNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode.Attributes["translate"] != null)
						_strAltCategory = objArmorNode.Attributes["translate"].InnerText;
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
			objWriter.WriteStartElement("armormod");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("name_english", _strName);
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("category_english", _strCategory);
			objWriter.WriteElementString("b", _intB.ToString());
			objWriter.WriteElementString("i", _intI.ToString());
			objWriter.WriteElementString("maxrating", _intMaxRating.ToString());
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("included", _blnIncludedInArmor.ToString());
			objWriter.WriteElementString("equipped", _blnEquipped.ToString());
			objWriter.WriteElementString("extra", LanguageManager.Instance.TranslateExtra(_strExtra));
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this piece of Armor in the Improvement system.
		/// </summary>
		public string InternalId
		{
			get
			{
				return _guiID.ToString();
			}
		}

		/// <summary>
		/// Guid of a Cyberware Weapon.
		/// </summary>
		public string WeaponID
		{
			get
			{
				return _guiWeaponID.ToString();
			}
			set
			{
				_guiWeaponID = Guid.Parse(value);
			}
		}

		/// <summary>
		/// Bonus node from the XML file.
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
		/// Name of the Mod.
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

				if (_intRating > 0)
					strReturn += " (" + LanguageManager.Instance.GetString("String_Rating") + " " + _intRating.ToString() + ")";
				if (_strExtra != "")
					strReturn += " (" + LanguageManager.Instance.TranslateExtra(_strExtra) + ")";
				return strReturn;
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
		/// Special Armor Mod Category.
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
		/// Mod's Ballistic value modifier.
		/// </summary>
		public int Ballistic
		{
			get
			{
				return _intB;
			}
			set
			{
				_intB = value;
			}
		}

		/// <summary>
		/// Mod's Impact value modifier.
		/// </summary>
		public int Impact
		{
			get
			{
				return _intI;
			}
			set
			{
				_intI = value;
			}
		}

		/// <summary>
		/// Armor capacity.
		/// </summary>
		public string ArmorCapacity
		{
			get
			{
				return _strArmorCapacity;
			}
			set
			{
				_strArmorCapacity = value;
			}
		}

		/// <summary>
		/// Mod's Maximum Rating.
		/// </summary>
		public int MaximumRating
		{
			get
			{
				return _intMaxRating;
			}
			set
			{
				_intMaxRating = value;
			}
		}

		/// <summary>
		/// Mod's current Rating.
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
		/// Mod's Availability.
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
		/// The Mod's cost.
		/// </summary>
		public string Cost
		{
			get
			{
				if (_strCost.Contains("Rating"))
				{
					// If the cost is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCost = "";
					string strCostExpression = _strCost;

					strCost = strCostExpression.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCost);
					return nav.Evaluate(xprCost).ToString();
				}
				else
				{
					// Just a straight cost, so return the value.
					return _strCost;
				}
			}
			set
			{
				_strCost = value;
			}
		}

		/// <summary>
		/// Mod's Sourcebook.
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
		/// Whether or not an Armor Mod is equipped and should be included in the Armor's totals.
		/// </summary>
		public bool Equipped
		{
			get
			{
				return _blnEquipped;
			}
			set
			{
				_blnEquipped = value;
			}
		}

		/// <summary>
		/// Whether or not this Mod is part of the base Armor configuration.
		/// </summary>
		public bool IncludedInArmor
		{
			get
			{
				return _blnIncludedInArmor;
			}
			set
			{
				_blnIncludedInArmor = value;
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
		/// Value that was selected during the Improvement Manager dialogue.
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
		/// Whether or not the Armor Mod's cost should be discounted by 10% through the Black Market Pipeline Quality.
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

		/// <summary>
		/// Parent Armor.
		/// </summary>
		public Armor Parent
		{
			get
			{
				return _objParent;
			}
			set
			{
				_objParent = value;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// Total Availablility of the Gear and its accessories.
		/// </summary>
		public string TotalAvail
		{
			get
			{
				// If the Avail contains "+", return the base string and don't try to calculate anything since we're looking at a child component.
				if (_strAvail.Contains("+"))
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
		/// Caculated Capacity of the Armor Mod.
		/// </summary>
		public string CalculatedCapacity
		{
			get
			{
				if (_strArmorCapacity.Contains("/["))
				{
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					int intPos = _strArmorCapacity.IndexOf("/[");
					string strFirstHalf = _strArmorCapacity.Substring(0, intPos);
					string strSecondHalf = _strArmorCapacity.Substring(intPos + 1, _strArmorCapacity.Length - intPos - 1);
					bool blnSquareBrackets = false;
					string strCapacity = "";

					try
					{
						blnSquareBrackets = strFirstHalf.Contains('[');
						strCapacity = strFirstHalf;
						if (blnSquareBrackets)
							strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
					}
					catch
					{
					}
					XPathExpression xprCapacity = nav.Compile(strCapacity.Replace("Rating", _intRating.ToString()));

					string strReturn = "";
					try
					{
						if (_strArmorCapacity == "[*]")
							strReturn = "*";
						else
						{
							if (_strArmorCapacity.StartsWith("FixedValues"))
							{
								string[] strValues = _strArmorCapacity.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
								strReturn = strValues[Convert.ToInt32(_intRating) - 1];
							}
							else
								strReturn = nav.Evaluate(xprCapacity).ToString();
						}
						if (blnSquareBrackets)
							strReturn = "[" + strCapacity + "]";
					}
					catch
					{
						strReturn = "0";
					}
					strReturn += "/" + strSecondHalf;
					return strReturn;
				}
				else if (_strArmorCapacity.Contains("Rating"))
				{
					// If the Capaicty is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					// XPathExpression cannot evaluate while there are square brackets, so remove them if necessary.
					bool blnSquareBrackets = _strArmorCapacity.Contains('[');
					string strCapacity = _strArmorCapacity;
					if (blnSquareBrackets)
						strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
					XPathExpression xprCapacity = nav.Compile(strCapacity.Replace("Rating", _intRating.ToString()));

					string strReturn = nav.Evaluate(xprCapacity).ToString();
					if (blnSquareBrackets)
						strReturn = "[" + strReturn + "]";

					return strReturn;
				}
				else
				{
					// Just a straight Capacity, so return the value.
					if (_strArmorCapacity == "")
						return "0";
					else if (_strArmorCapacity.StartsWith("FixedValues"))
					{
						string[] strValues = _strArmorCapacity.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						return strValues[Convert.ToInt32(_intRating) - 1];
					}
					else
						return _strArmorCapacity;
				}
			}
		}

		/// <summary>
		/// Total cost of the Armor Mod.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intReturn = 0;

				if (_strCost.Contains("Armor Cost"))
				{
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCostExpr = _strCost.Replace("Armor Cost", _objParent.Cost.ToString());
					XPathExpression xprCost = nav.Compile(strCostExpr);
					intReturn = Convert.ToInt32(Math.Ceiling(Convert.ToDouble(nav.Evaluate(xprCost).ToString(), GlobalOptions.Instance.CultureInfo)));
				}
				else if (_strCost.Contains("Rating"))
				{
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCostExpr = _strCost.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCostExpr);
					intReturn = Convert.ToInt32(Math.Ceiling(Convert.ToDouble(nav.Evaluate(xprCost).ToString(), GlobalOptions.Instance.CultureInfo)));
				}
				else
					intReturn = Convert.ToInt32(_strCost);

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intReturn;
			}
		}

		/// <summary>
		/// Cost for just the Armor Mod.
		/// </summary>
		public int OwnCost
		{
			get
			{
				return TotalCost;
			}
		}
		#endregion
	}

	/// <summary>
	/// A specific piece of Armor.
	/// </summary>
	public class Armor
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private string _strB = "0";
		private string _strI = "0";
		private string _strArmorCapacity = "0";
		private string _strAvail = "";
		private int _intCost = 0;
		private string _strSource = "";
		private string _strPage = "";
		private string _strArmorName = "";
		private string _strExtra = "";
		private int _intBDamage = 0;
		private int _intIDamage = 0;
		private bool _blnEquipped = true;
		private readonly Character _objCharacter;
		private List<ArmorMod> _lstArmorMods = new List<ArmorMod>();
		private List<Gear> _lstGear = new List<Gear>();
		private string _strNotes = "";
		protected string _strLocation = "";
		private XmlNode _nodBonus;
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private bool _blnDiscountCost = false;

		#region Constructor, Create, Save, Load, and Print Methods
		public Armor(Character objCharacter)
		{
			// Create the GUID for the new piece of Armor.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Cyberware from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlArmorNode">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="cmsArmorMod">ContextMenuStrip to apply to Armor Mode TreeNodes.</param>
		/// <param name="blnSkipCost">Whether or not creating the Armor should skip the Variable price dialogue (should only be used by frmSelectArmor).</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		public void Create(XmlNode objXmlArmorNode, TreeNode objNode, ContextMenuStrip cmsArmorMod, bool blnSkipCost = false, bool blnCreateChildren = true)
		{
			_strName = objXmlArmorNode["name"].InnerText;
			_strCategory = objXmlArmorNode["category"].InnerText;
			_strB = objXmlArmorNode["b"].InnerText;
			_strI = objXmlArmorNode["i"].InnerText;
			_strArmorCapacity = objXmlArmorNode["armorcapacity"].InnerText;
			_strAvail = objXmlArmorNode["avail"].InnerText;
			_strSource = objXmlArmorNode["source"].InnerText;
			_strPage = objXmlArmorNode["page"].InnerText;
			_nodBonus = objXmlArmorNode["bonus"];

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("armor.xml");
				XmlNode objArmorNode = objXmlDocument.SelectSingleNode("/chummer/armors/armor[name = \"" + _strName + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode["translate"] != null)
						_strAltName = objArmorNode["translate"].InnerText;
					if (objArmorNode["altpage"] != null)
						_strAltPage = objArmorNode["altpage"].InnerText;
				}

				objArmorNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objNode != null)
				{
					if (objArmorNode.Attributes["translate"] != null)
						_strAltCategory = objArmorNode.Attributes["translate"].InnerText;
				}
			}

			// Check for a Variable Cost.
			if (objXmlArmorNode["cost"].InnerText.StartsWith("Variable"))
			{
				if (blnSkipCost)
					_intCost = 0;
				else
				{
					int intMin = 0;
					int intMax = 0;
					string strCost = objXmlArmorNode["cost"].InnerText.Replace("Variable(", string.Empty).Replace(")", string.Empty);
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
						_intCost = frmPickNumber.SelectedValue;
					}
				}
			}
			else
				_intCost = Convert.ToInt32(objXmlArmorNode["cost"].InnerText);

			if (objXmlArmorNode["bonus"] != null && !blnSkipCost)
			{
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				if (!objImprovementManager.CreateImprovements(Improvement.ImprovementSource.Armor, _guiID.ToString(), objXmlArmorNode["bonus"], false, 1, DisplayNameShort))
				{
					_guiID = Guid.Empty;
					return;
				}
				if (objImprovementManager.SelectedValue != "")
				{
					_strExtra = objImprovementManager.SelectedValue;
					objNode.Text += " (" + objImprovementManager.SelectedValue + ")";
				}
			}

			// Add any Armor Mods that come with the Armor.
			if (objXmlArmorNode["mods"] != null && blnCreateChildren)
			{
				XmlDocument objXmlArmorDocument = XmlManager.Instance.Load("armor.xml");

				foreach (XmlNode objXmlArmorMod in objXmlArmorNode.SelectNodes("mods/name"))
				{
					int intRating = 0;
					string strForceValue = "";
					if (objXmlArmorMod.Attributes["rating"] != null)
						intRating = Convert.ToInt32(objXmlArmorMod.Attributes["rating"].InnerText);
					if (objXmlArmorMod.Attributes["select"] != null)
						strForceValue = objXmlArmorMod.Attributes["select"].ToString();

					XmlNode objXmlMod = objXmlArmorDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + objXmlArmorMod.InnerText + "\"]");
					ArmorMod objMod = new ArmorMod(_objCharacter);
					List<Weapon> lstWeapons = new List<Weapon>();
					List<TreeNode> lstWeaponNodes = new List<TreeNode>();

					TreeNode objModNode = new TreeNode();

					objMod.Create(objXmlMod, objModNode, intRating, lstWeapons, lstWeaponNodes, blnSkipCost);
					objMod.Parent = this;
					objMod.IncludedInArmor = true;
					objMod.ArmorCapacity = "[0]";
					objMod.Cost = "0";
					objMod.MaximumRating = objMod.Rating;
					_lstArmorMods.Add(objMod);

					objModNode.ContextMenuStrip = cmsArmorMod;
					objNode.Nodes.Add(objModNode);
					objNode.Expand();
				}
			}

			// Add any Gear that comes with the Armor.
			if (objXmlArmorNode["gears"] != null && blnCreateChildren)
			{
				XmlDocument objXmlGearDocument = XmlManager.Instance.Load("gear.xml");
				foreach (XmlNode objXmlArmorGear in objXmlArmorNode.SelectNodes("gears/usegear"))
				{
					int intRating = 0;
					string strForceValue = "";
					if (objXmlArmorGear.Attributes["rating"] != null)
						intRating = Convert.ToInt32(objXmlArmorGear.Attributes["rating"].InnerText);
					if (objXmlArmorGear.Attributes["select"] != null)
						strForceValue = objXmlArmorGear.Attributes["select"].InnerText;

					XmlNode objXmlGear = objXmlGearDocument.SelectSingleNode("/chummer/gears/gear[name = \"" + objXmlArmorGear.InnerText + "\"]");
					Gear objGear = new Gear(_objCharacter);

					TreeNode objGearNode = new TreeNode();
					List<Weapon> lstWeapons = new List<Weapon>();
					List<TreeNode> lstWeaponNodes = new List<TreeNode>();

					objGear.Create(objXmlGear, _objCharacter, objGearNode, intRating, lstWeapons, lstWeaponNodes, strForceValue, false, false, !blnSkipCost);
					objGear.Capacity = "[0]";
					objGear.ArmorCapacity = "[0]";
					objGear.Cost = "0";
					objGear.MaxRating = objGear.Rating;
					objGear.MinRating = objGear.Rating;
					objGear.IncludedInParent = true;
					_lstGear.Add(objGear);

					objNode.Nodes.Add(objGearNode);
					objNode.Expand();
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
			objWriter.WriteStartElement("armor");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("b", _strB);
			objWriter.WriteElementString("i", _strI);
			objWriter.WriteElementString("armorcapacity", _strArmorCapacity);
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _intCost.ToString());
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("armorname", _strArmorName);
			objWriter.WriteElementString("equipped", _blnEquipped.ToString());
			objWriter.WriteElementString("extra", _strExtra);
			objWriter.WriteElementString("bdamage", _intBDamage.ToString());
			objWriter.WriteElementString("idamage", _intIDamage.ToString());
			objWriter.WriteStartElement("armormods");
			foreach (ArmorMod objMod in _lstArmorMods)
			{
				objMod.Save(objWriter);
			}
			objWriter.WriteEndElement();
			if (_lstGear.Count > 0)
			{
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
			}
			if (_nodBonus != null)
				objWriter.WriteRaw(_nodBonus.OuterXml);
			else
				objWriter.WriteElementString("bonus", "");
			objWriter.WriteElementString("location", _strLocation);
			objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteElementString("discountedcost", DiscountCost.ToString());
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the Attribute from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode, bool blnCopy = false)
		{
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strCategory = objNode["category"].InnerText;
			_strB = objNode["b"].InnerText;
			_strI = objNode["i"].InnerText;
			try
			{
				_strArmorCapacity = objNode["armorcapacity"].InnerText;
			}
			catch
			{
			}
			_strAvail = objNode["avail"].InnerText;
			_intCost = Convert.ToInt32(objNode["cost"].InnerText);
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
				_strArmorName = objNode["armorname"].InnerText;
			}
			catch
			{
			}

			try
			{
				_blnEquipped = Convert.ToBoolean(objNode["equipped"].InnerText);
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

			try
			{
				_intBDamage = Convert.ToInt32(objNode["bdamage"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intIDamage = Convert.ToInt32(objNode["idamage"].InnerText);
			}
			catch
			{
			}

			if (objNode.InnerXml.Contains("armormods"))
			{
				XmlNodeList nodMods = objNode.SelectNodes("armormods/armormod");
				foreach (XmlNode nodMod in nodMods)
				{
					ArmorMod objMod = new ArmorMod(_objCharacter);
					objMod.Load(nodMod, blnCopy);
					objMod.Parent = this;
					_lstArmorMods.Add(objMod);
				}
			}
			if (objNode.InnerXml.Contains("gears"))
			{
				XmlNodeList nodGears = objNode.SelectNodes("gears/gear");
				foreach (XmlNode nodGear in nodGears)
				{
					switch (nodGear["category"].InnerText)
					{
						case "Commlink":
						case "Commlink Upgrade":
							Commlink objCommlink = new Commlink(_objCharacter);
							objCommlink.Load(nodGear, blnCopy);
							_lstGear.Add(objCommlink);
							break;
						case "Commlink Operating System":
						case "Commlink Operating System Upgrade":
							OperatingSystem objOperatingSystem = new OperatingSystem(_objCharacter);
							objOperatingSystem.Load(nodGear, blnCopy);
							_lstGear.Add(objOperatingSystem);
							break;
						default:
							Gear objGear = new Gear(_objCharacter);
							objGear.Load(nodGear, blnCopy);
							_lstGear.Add(objGear);
							break;
					}
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
				_strLocation = objNode["location"].InnerText;
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

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlArmorDocument = XmlManager.Instance.Load("armor.xml");
				XmlNode objArmorNode = objXmlArmorDocument.SelectSingleNode("/chummer/armors/armor[name = \"" + _strName + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode["translate"] != null)
						_strAltName = objArmorNode["translate"].InnerText;
					if (objArmorNode["altpage"] != null)
						_strAltPage = objArmorNode["altpage"].InnerText;
				}

				objArmorNode = objXmlArmorDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objArmorNode != null)
				{
					if (objArmorNode.Attributes["translate"] != null)
						_strAltCategory = objArmorNode.Attributes["translate"].InnerText;
				}
			}

			if (blnCopy)
			{
				_guiID = Guid.NewGuid();
				_strLocation = string.Empty;
			}
		}

		/// <summary>
		/// Print the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Print(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("armor");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("name_english", _strName);
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("category_english", _strCategory);
			objWriter.WriteElementString("b", TotalBallistic.ToString());
			objWriter.WriteElementString("i", TotalImpact.ToString());
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("armorname", _strArmorName);
			objWriter.WriteElementString("equipped", _blnEquipped.ToString());
			objWriter.WriteStartElement("armormods");
			foreach (ArmorMod objMod in _lstArmorMods)
			{
				objMod.Print(objWriter);
			}
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
			objWriter.WriteElementString("extra", LanguageManager.Instance.TranslateExtra(_strExtra));
			objWriter.WriteElementString("location", _strLocation);
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this piece of Armor in the Improvement system.
		/// </summary>
		public string InternalId
		{
			get
			{
				return _guiID.ToString();
			}
		}

		/// <summary>
		/// Name of the Armor.
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
		/// Bonus node from the XML file.
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
		/// Translated Category.
		/// </summary>
		public string DisplayCategory
		{
			get
			{
				string strReturn = _strCategory;
				if (_strAltCategory != string.Empty)
					return _strAltCategory;

				return strReturn;
			}
		}

		/// <summary>
		/// Armor's Category.
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
		/// Armor's Ballistic value.
		/// </summary>
		public string Ballistic
		{
			get
			{
				return _strB;
			}
			set
			{
				_strB = value;
			}
		}

		/// <summary>
		/// Armor's Impact value.
		/// </summary>
		public string Impact
		{
			get
			{
				return _strI;
			}
			set
			{
				_strI = value;
			}
		}

		/// <summary>
		/// Damage done to the Armor's Ballistic Rating.
		/// </summary>
		public int BallisticDamage
		{
			get
			{
				return _intBDamage;
			}
			set
			{
				_intBDamage = value;

				int intTotalBallistic = Convert.ToInt32(_strB);

				// Go through all of the Mods for this piece of Armor and add the Ballistic value.
				foreach (ArmorMod objMod in _lstArmorMods)
				{
					if (objMod.Equipped)
						intTotalBallistic += objMod.Ballistic;
				}

				if (_intBDamage < 0)
					_intBDamage = 0;
				if (_intBDamage > intTotalBallistic)
					_intBDamage = intTotalBallistic;
			}
		}

		/// <summary>
		/// Damage done to the Armor's Impact Rating.
		/// </summary>
		public int ImpactDamage
		{
			get
			{
				return _intIDamage;
			}
			set
			{
				_intIDamage = value;

				int intTotalImpact = Convert.ToInt32(_strI);

				// Go through all of the Mods for this piece of Armor and add the Impact value.
				foreach (ArmorMod objMod in _lstArmorMods)
				{
					if (objMod.Equipped)
						intTotalImpact += objMod.Impact;
				}

				if (_intIDamage < 0)
					_intIDamage = 0;
				if (_intIDamage > intTotalImpact)
					_intIDamage = intTotalImpact;
			}
		}

		/// <summary>
		/// Armor's Capacity.
		/// </summary>
		public string ArmorCapacity
		{
			get
			{
				return _strArmorCapacity;
			}
			set
			{
				_strArmorCapacity = value;
			}
		}

		/// <summary>
		/// Armor's Availability.
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
		/// Armor's Cost.
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
		/// Armor's Sourcebook.
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
		/// Whether or not the Armor is equipped and should be considered for highest Armor Rating or Armor Encumbrance.
		/// </summary>
		public bool Equipped
		{
			get
			{
				return _blnEquipped;
			}
			set
			{
				_blnEquipped = value;
			}
		}

		/// <summary>
		/// The Armor's total Ballistic value including Modifications.
		/// </summary>
		public int TotalBallistic
		{
			get
			{
				int intTotalBallistic = Convert.ToInt32(_strB);
				
				// Go through all of the Mods for this piece of Armor and add the Ballistic value.
				foreach (ArmorMod objMod in _lstArmorMods)
				{
					if (objMod.Equipped)
						intTotalBallistic += objMod.Ballistic;
				}

				intTotalBallistic -= _intBDamage;

				return intTotalBallistic;
			}
		}

		/// <summary>
		/// The Armor's total Impact value including Modifications.
		/// </summary>
		public int TotalImpact
		{
			get
			{
				int intTotalImpact = Convert.ToInt32(_strI);

				// Go through all of the Mods for this piece of Armor and add the Impact value.
				foreach (ArmorMod objMod in _lstArmorMods)
				{
					if (objMod.Equipped)
						intTotalImpact += objMod.Impact;
				}

				intTotalImpact -= _intIDamage;

				return intTotalImpact;
			}
		}

		/// <summary>
		/// The Armor's total Cost including Modifications.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intTotalCost = _intCost;

				if (DiscountCost)
					intTotalCost = Convert.ToInt32(Convert.ToDouble(intTotalCost, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Go through all of the Mods for this piece of Armor and add the Cost value.
				foreach (ArmorMod objMod in _lstArmorMods)
					intTotalCost += objMod.TotalCost;

				// Go through all of the Gear for this piece of Armor and add the Cost value.
				foreach (Gear objGear in _lstGear)
					intTotalCost += objGear.TotalCost;

				return intTotalCost;
			}
		}

		/// <summary>
		/// Cost for just the Armor.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intTotalCost = _intCost;

				if (DiscountCost)
					intTotalCost = Convert.ToInt32(Convert.ToDouble(intTotalCost, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intTotalCost;
			}
		}

		/// <summary>
		/// The Modifications currently applied to the Armor.
		/// </summary>
		public List<ArmorMod> ArmorMods
		{
			get
			{
				return _lstArmorMods;
			}
		}

		/// <summary>
		/// The Gear currently applied to the Armor.
		/// </summary>
		public List<Gear> Gear
		{
			get
			{
				return _lstGear;
			}
		}

		/// <summary>
		/// Location.
		/// </summary>
		public string Location
		{
			get
			{
				return _strLocation;
			}
			set
			{
				_strLocation = value;
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
		/// Total Availablility of the Armor and its Modifications and Gear.
		/// </summary>
		public string TotalAvail
		{
			get
			{
				// If the Avail contains "+", return the base string and don't try to calculate anything since we're looking at a child component.
				if (_strAvail.Contains("+"))
					return _strAvail;

				string strCalculated = "";
				string strReturn = "";


				// Just a straight cost, so return the value.
				string strAvail = "";
				if (_strAvail.Contains("F") || _strAvail.Contains("R"))
				{
					strAvail = _strAvail.Substring(_strAvail.Length - 1, 1);
					strCalculated = Convert.ToInt32(_strAvail.Substring(0, _strAvail.Length - 1)) + strAvail;
				}
				else
					strCalculated = Convert.ToInt32(_strAvail).ToString();

				int intAvail = 0;
				string strAvailText = "";
				if (strCalculated.Contains("F") || strCalculated.Contains("R"))
				{
					strAvailText = strCalculated.Substring(strCalculated.Length - 1);
					intAvail = Convert.ToInt32(strCalculated.Replace(strAvailText, string.Empty));
				}
				else
					intAvail = Convert.ToInt32(strCalculated);

				// Run through the child items and increase the Avail by any Mod whose Avail contains "+".
				foreach (Gear objChild in _lstGear)
				{
					if (objChild.Avail.Contains("+") && !objChild.IncludedInParent)
					{
						if (objChild.Avail.Contains("R") || objChild.Avail.Contains("F"))
						{
							if (strAvailText != "F")
								strAvailText = objChild.Avail.Substring(objChild.Avail.Length - 1);
							intAvail += Convert.ToInt32(objChild.Avail.Replace("F", string.Empty).Replace("R", string.Empty));
						}
						else
							intAvail += Convert.ToInt32(objChild.Avail);
					}
				}

				// Run through the child items and increase the Avail by any Mod whose Avail contains "+".
				foreach (ArmorMod objChild in _lstArmorMods)
				{
					if (objChild.Avail.Contains("+") && !objChild.IncludedInArmor)
					{
						if (objChild.Avail.Contains("R") || objChild.Avail.Contains("F"))
						{
							if (strAvailText != "F")
								strAvailText = objChild.Avail.Substring(objChild.Avail.Length - 1);
							intAvail += Convert.ToInt32(objChild.Avail.Replace("F", string.Empty).Replace("R", string.Empty));
						}
						else
							intAvail += Convert.ToInt32(objChild.Avail);
					}
				}

				strReturn = intAvail.ToString() + strAvailText;

				// Translate the Avail string.
				strReturn = strReturn.Replace("R", LanguageManager.Instance.GetString("String_AvailRestricted"));
				strReturn = strReturn.Replace("F", LanguageManager.Instance.GetString("String_AvailForbidden"));

				return strReturn;
			}
		}

		/// <summary>
		/// Calculated Capacity of the Armor.
		/// </summary>
		public string CalculatedCapacity
		{
			get
			{
				string strReturn = "";

				// If an Armor Capacity is specified for the Armor, use that value. Otherwise, use the higher of 6 or (Highest Armor Rating * 1.5, round up).
				if (_strArmorCapacity == "" || _strArmorCapacity == "0")
				{
					// This is only calculated if the Maximum Armor Modification rule is enabled.
					if (_objCharacter.Options.MaximumArmorModifications)
					{
						double dblB = Math.Ceiling(Convert.ToDouble(_strB, GlobalOptions.Instance.CultureInfo) * 1.5);
						double dblI = Math.Ceiling(Convert.ToDouble(_strI, GlobalOptions.Instance.CultureInfo) * 1.5);
						double dblHighest = Math.Max(dblB, dblI);
						double dblReturn = Math.Max(dblHighest, 6.0);
						strReturn = dblReturn.ToString();
					}
					else
						strReturn = "0";
				}
				else
				{
					// Armor Capacity is only used if the Armor Suit Capacity rule is enabled.
					if (_objCharacter.Options.ArmorSuitCapacity)
						strReturn = _strArmorCapacity;
					else
						strReturn = "0";
				}

				return strReturn;
			}
		}

		/// <summary>
		/// The amount of Capacity remaining in the Gear.
		/// </summary>
		public int CapacityRemaining
		{
			get
			{
				int intCapacity = 0;
				// Get the Armor base Capacity.
				intCapacity = Convert.ToInt32(CalculatedCapacity);

				// If there is no Capacity (meaning that the Armor Suit Capacity or Maximum Armor Modification rule is turned off depending on the type of Armor), don't bother to calculate the remaining
				// Capacity since it's disabled and return 0 instead.
				if (intCapacity == 0)
					return 0;

				// Calculate the remaining Capacity for a Suit of Armor.
				if (_strArmorCapacity != "0" && _strArmorCapacity != "" && _objCharacter.Options.ArmorSuitCapacity)
				{
					// Run through its Armor Mods and deduct the Capacity costs.
					foreach (ArmorMod objMod in _lstArmorMods)
					{
						string strCapacity = objMod.CalculatedCapacity;
						if (strCapacity.Contains("/["))
						{
							// If this is a multiple-capacity item, use only the second half.
							int intPos = strCapacity.IndexOf("/[");
							strCapacity = strCapacity.Substring(intPos + 1);
						}

						if (strCapacity.Contains("["))
							strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
						if (strCapacity == "*")
							strCapacity = "0";
						intCapacity -= Convert.ToInt32(strCapacity);
					}

					// Run through its Gear and deduct the Armor Capacity costs.
					foreach (Gear objGear in _lstGear)
					{
						string strCapacity = objGear.CalculatedArmorCapacity;
						if (strCapacity.Contains("/["))
						{
							// If this is a multiple-capacity item, use only the second half.
							int intPos = strCapacity.IndexOf("/[");
							strCapacity = strCapacity.Substring(intPos + 1);
						}

						if (strCapacity.Contains("["))
							strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
						if (strCapacity == "*")
							strCapacity = "0";
						intCapacity -= Convert.ToInt32(strCapacity);
					}
				}

				// Calculate the remaining Capacity for a standard piece of Armor using the Maximum Armor Modifications rules.
				if ((_strArmorCapacity == "0" || _strArmorCapacity == "") && _objCharacter.Options.MaximumArmorModifications)
				{
					// Run through its Armor Mods and deduct the Rating (or 1 if it has no Rating).
					foreach (ArmorMod objMod in _lstArmorMods)
					{
						if (objMod.Rating > 0)
							intCapacity -= objMod.Rating;
						else
							intCapacity -= 1;
					}

					// Run through its Gear and deduct the Rating (or 1 if it has no Rating).
					foreach (Gear objGear in _lstGear)
					{
						if (objGear.Rating > 0)
							intCapacity -= objGear.Rating;
						else
							intCapacity -= 1;
					}
				}

				return intCapacity;
			}
		}

		/// <summary>
		/// Capacity display style;
		/// </summary>
		public CapacityStyle CapacityDisplayStyle
		{
			get
			{
				CapacityStyle objReturn = CapacityStyle.Zero;
				
				if ((_strArmorCapacity == "" || _strArmorCapacity == "0") && _objCharacter.Options.MaximumArmorModifications)
					objReturn = CapacityStyle.PerRating;
				if (_strArmorCapacity != "" && _strArmorCapacity != "0" && _objCharacter.Options.ArmorSuitCapacity)
					objReturn = CapacityStyle.Standard;

				return objReturn;
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
					return _strAltName;

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

				if (_strArmorName != "")
					strReturn += " (\"" + _strArmorName + "\")";

				if (_strExtra != "")
					strReturn += " (" + LanguageManager.Instance.TranslateExtra(_strExtra) + ")";
				return strReturn;
			}
		}

		/// <summary>
		/// A custom name for the Armor assigned by the player.
		/// </summary>
		public string ArmorName
		{
			get
			{
				return _strArmorName;
			}
			set
			{
				_strArmorName = value;
			}
		}
		#endregion
	}
}