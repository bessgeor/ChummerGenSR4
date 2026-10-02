using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using System.Xml;
using System.Xml.XPath;

namespace Chummer
{
	/// <summary>
	/// Grade of Cyberware or Bioware.
	/// </summary>
	public class Grade
	{
		private string _strName = "Standard";
		private string _strAltName = "";
		private decimal _decEss = 1.0m;
		private double _dblCost = 1.0;
		private int _intAvail = 0;
		private string _strSource = "SR4";

		#region Constructor and Load Methods
		public Grade()
		{
		}

		/// <summary>
		/// Load the Grade from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode)
		{
			_strName = objNode["name"].InnerText;
			if (objNode["translate"] != null)
				_strAltName = objNode["translate"].InnerText;
			_decEss = Convert.ToDecimal(objNode["ess"].InnerText, GlobalOptions.Instance.CultureInfo);
			_dblCost = Convert.ToDouble(objNode["cost"].InnerText, GlobalOptions.Instance.CultureInfo);
			_intAvail = Convert.ToInt32(objNode["avail"].InnerText, GlobalOptions.Instance.CultureInfo);
			_strSource = objNode["source"].InnerText;
		}
		#endregion

		#region Properties
		/// <summary>
		/// The English name of the Grade.
		/// </summary>
		public string Name
		{
			get
			{
				return _strName;
			}
		}

		/// <summary>
		/// The name of the Grade as it should be displayed in lists.
		/// </summary>
		public string DisplayName
		{
			get
			{
				if (_strAltName != string.Empty)
					return _strAltName;
				else
					return _strName;
			}
		}

		/// <summary>
		/// The Grade's Essence cost multiplier.
		/// </summary>
		public decimal Essence
		{
			get
			{
				return _decEss;
			}
		}

		/// <summary>
		/// The Grade's cost multiplier.
		/// </summary>
		public double Cost
		{
			get
			{
				return _dblCost;
			}
		}

		/// <summary>
		/// The Grade's Availability modifier.
		/// </summary>
		public int Avail
		{
			get
			{
				return _intAvail;
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
		}

		/// <summary>
		/// Whether or not the Grade is for Adapsin.
		/// </summary>
		public bool Adapsin
		{
			get
			{
				return _strName.Contains("(Adapsin)");
			}
		}

		/// <summary>
		/// Whether or not this is a Second-Hand Grade.
		/// </summary>
		public bool SecondHand
		{
			get
			{
				return _strName.Contains("(Second-Hand)");
			}
		}
		#endregion
	}

	/// <summary>
	/// List of Grades for either Cyberware or Bioware.
	/// </summary>
	public class GradeList : IEnumerable<Grade>
	{
		/// <summary>
		/// Grades of Cyberware.
		/// </summary>
		public static GradeList CyberwareGrades = new GradeList();
		/// <summary>
		/// Grades of Bioware.
		/// </summary>
		public static GradeList BiowareGrades = new GradeList();

		private List<Grade> _lstGrades = new List<Grade>();

		static GradeList()
		{
			CyberwareGrades.LoadList(Improvement.ImprovementSource.Cyberware);
			BiowareGrades.LoadList(Improvement.ImprovementSource.Bioware);
		}

		#region Methods
		/// <summary>
		/// Fill the list of CyberwareGrades from the XML files.
		/// </summary>
		/// <param name="objSource">Source to load the Grades from, either Bioware or Cyberware.</param>
		public void LoadList(Improvement.ImprovementSource objSource)
		{
			string strXmlFile = "";
			if (objSource == Improvement.ImprovementSource.Bioware)
				strXmlFile = "bioware.xml";
			else
				strXmlFile = "cyberware.xml";
			XmlDocument objXMlDocument = XmlManager.Instance.Load(strXmlFile);
			
			foreach (XmlNode objNode in objXMlDocument.SelectNodes("/chummer/grades/grade"))
			{
				Grade objGrade = new Grade();
				objGrade.Load(objNode);
				_lstGrades.Add(objGrade);
			}
		}

		/// <summary>
		/// Retrieve the Standard Grade from the list.
		/// </summary>
		public Grade GetGrade(string strGrade)
		{
			Grade objReturn = new Grade();
			foreach (Grade objGrade in _lstGrades)
			{
				if (objGrade.Name == "Standard")
				{
					objReturn = objGrade;
					break;
				}
			}

			if (strGrade != "Standard")
			{
				foreach (Grade objGrade in _lstGrades)
				{
					if (objGrade.Name == strGrade)
					{
						objReturn = objGrade;
						break;
					}
				}
			}

			return objReturn;
		}
		#endregion

		#region Enumeration Methods
		public IEnumerator<Grade> GetEnumerator()
		{
			return this._lstGrades.GetEnumerator();
		}

		IEnumerator IEnumerable.GetEnumerator()
		{
			return GetEnumerator();
		}
		#endregion
	}

	/// <summary>
	/// A piece of Cyberware.
	/// </summary>
	public class Cyberware : ICharacterCyberware
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private string _strLimbSlot = "";
		private string _strESS = "";
		private string _strCapacity = "";
		private string _strAvail = "";
		private string _strCost = "";
		private string _strSource = "";
		private string _strPage = "";
		private int _intRating = 0;
		private int _intMinRating = 0;
		private int _intMaxRating = 0;
		private string _strSubsystems = "";
		private bool _blnSuite = false;
		private string _strLocation = "";
		private Guid _guiWeaponID = new Guid();
		private Grade _objGrade = new Grade();
		private List<Cyberware> _objChildren = new List<Cyberware>();
		private List<Gear> _lstGear = new List<Gear>();
		private XmlNode _nodBonus;
		private XmlNode _nodAllowGear;
		private Improvement.ImprovementSource _objImprovementSource = Improvement.ImprovementSource.Cyberware;
		private string _strNotes = "";
		private int _intEssenceDiscount = 0;
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private string _strForceGrade = "";
		private bool _blnDiscountCost = false;
		private Cyberware _objParent;

		private readonly ICharacter _objCharacter;

		#region Helper Methods
		/// <summary>
		/// Convert a string to a Grade.
		/// </summary>
		/// <param name="strValue">String value to convert.</param>
		public Grade ConvertToCyberwareGrade(string strValue, Improvement.ImprovementSource objSource)
		{
			if (objSource == Improvement.ImprovementSource.Bioware)
			{
				foreach (Grade objGrade in GradeList.BiowareGrades)
				{
					if (objGrade.Name == strValue)
						return objGrade;
				}

				return GradeList.BiowareGrades.GetGrade("Standard");
			}
			else
			{
				foreach (Grade objGrade in GradeList.CyberwareGrades)
				{
					if (objGrade.Name == strValue)
						return objGrade;
				}

				return GradeList.CyberwareGrades.GetGrade("Standard");
			}
		}
		#endregion

		#region Constructor, Create, Save, Load, and Print Methods
		public Cyberware(ICharacter objCharacter)
		{
			// Create the GUID for the new piece of Cyberware.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Cyberware from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlCyberware">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character object the Cyberware will be added to.</param>
		/// <param name="objGrade">Grade of the selected piece.</param>
		/// <param name="objSource">Source of the piece.</param>
		/// <param name="intRating">Selected Rating of the piece of Cyberware.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="funcAddWeapon">Adds each Weapon that should be added to the Character with the TreeNode that represents it.</param>
		/// <param name="blnCreateImprovements">Whether or not Improvements should be created.</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		/// <param name="strForced">Force a particular value to be selected by an Improvement prompts.</param>
		public void Create(XmlNode objXmlCyberware, ICharacter objCharacter, Grade objGrade, Improvement.ImprovementSource objSource, int intRating, ITreeNodeView objNode, Action<IEquipmentWeapon, ITreeNodeView> funcAddWeapon, bool blnCreateImprovements = true, bool blnCreateChildren = true, string strForced = "")
		{
			_strName = objXmlCyberware["name"].InnerText;
			_strCategory = objXmlCyberware["category"].InnerText;
			if (objXmlCyberware["limbslot"] != null)
				_strLimbSlot = objXmlCyberware["limbslot"].InnerText;
			_objGrade = objGrade;
			_intRating = intRating;
			_strESS = objXmlCyberware["ess"].InnerText;
			_strCapacity = objXmlCyberware["capacity"].InnerText;
			_strAvail = objXmlCyberware["avail"].InnerText;
			_strCost = objXmlCyberware["cost"].InnerText;
			_strSource = objXmlCyberware["source"].InnerText;
			_strPage = objXmlCyberware["page"].InnerText;
			_nodBonus = objXmlCyberware["bonus"];
			_nodAllowGear = objXmlCyberware["allowgear"];
			_objImprovementSource = objSource;
			try
			{
				_intMaxRating = Convert.ToInt32(objXmlCyberware["rating"].InnerText);
			}
			catch
			{
				_intMaxRating = 0;
			}
			try
			{
				_intMinRating = Convert.ToInt32(objXmlCyberware["minrating"].InnerText);
			}
			catch
			{
				if (_intMaxRating > 0)
					_intMinRating = 1;
				else
					_intMinRating = 0;
			}
			try
			{
				_strForceGrade = objXmlCyberware["forcegrade"].InnerText;
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				string strXmlFile = "";
				string strXPath = "";
				if (_objImprovementSource == Improvement.ImprovementSource.Bioware)
				{
					strXmlFile = "bioware.xml";
					strXPath = "/chummer/biowares/bioware";
				}
				else
				{
					strXmlFile = "cyberware.xml";
					strXPath = "/chummer/cyberwares/cyberware";
				}
				XmlDocument objXmlDocument = XmlManager.Instance.Load(strXmlFile);
				XmlNode objCyberwareNode = objXmlDocument.SelectSingleNode(strXPath + "[name = \"" + _strName + "\"]");
				if (objCyberwareNode != null)
				{
					if (objCyberwareNode["translate"] != null)
						_strAltName = objCyberwareNode["translate"].InnerText;
					if (objCyberwareNode["altpage"] != null)
						_strAltPage = objCyberwareNode["altpage"].InnerText;
				}

				objCyberwareNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objCyberwareNode != null)
				{
					if (objCyberwareNode.Attributes["translate"] != null)
						_strAltCategory = objCyberwareNode.Attributes["translate"].InnerText;
				}
			}

			// Add Subsytem information if applicable.
			if (objXmlCyberware.InnerXml.Contains("subsystems"))
			{
				string strSubsystem = "";
				foreach (XmlNode objXmlSubsystem in objXmlCyberware.SelectNodes("subsystems/subsystem"))
				{
					strSubsystem += objXmlSubsystem.InnerText + ",";
				}
				_strSubsystems = strSubsystem;
			}

			// Check for a Variable Cost.
			if (objXmlCyberware["cost"].InnerText.StartsWith("Variable"))
			{
				int intMin = 0;
				int intMax = 0;
				string strCost = objXmlCyberware["cost"].InnerText.Replace("Variable(", string.Empty).Replace(")", string.Empty);
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
					if (intMax == 0)
						intMax = 1000000;
					_strCost = ApplicationHost.Current.Equipment.SelectNumber(intMin, intMax, LanguageManager.Instance.GetString("String_SelectVariableCost").Replace("{0}", DisplayNameShort)).ToString();
				}
			}

			// Add Cyberweapons if applicable.
			if (objXmlCyberware.InnerXml.Contains("<addweapon>"))
			{
				XmlDocument objXmlWeaponDocument = XmlManager.Instance.Load("weapons.xml");

				// More than one Weapon can be added, so loop through all occurrences.
				foreach (XmlNode objXmlAddWeapon in objXmlCyberware.SelectNodes("addweapon"))
				{
					XmlNode objXmlWeapon = objXmlWeaponDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + objXmlAddWeapon.InnerText + "\" and starts-with(category, \"Cyberware\")]");

					ITreeNodeView objGearWeaponNode = objNode.NewNode();
					IEquipmentWeapon objGearWeapon = ApplicationHost.Current.Equipment.CreateWeapon(objXmlWeapon, objCharacter, objGearWeaponNode);
					objGearWeaponNode.ShowAsGrayText();
					funcAddWeapon(objGearWeapon, objGearWeaponNode);

					_guiWeaponID = Guid.Parse(objGearWeapon.InternalId);
				}
			}

			// If the piece grants a bonus, pass the information to the Improvement Manager.
			if (objXmlCyberware["bonus"] != null && blnCreateImprovements)
			{
				ImprovementManager objImprovementManager = new ImprovementManager(objCharacter);
				if (strForced != "")
					objImprovementManager.ForcedValue = strForced;

				if (!objImprovementManager.CreateImprovements(objSource, _guiID.ToString(), _nodBonus, false, _intRating, DisplayNameShort))
				{
					_guiID = Guid.Empty;
					return;
				}
				if (objImprovementManager.SelectedValue != "")
					_strLocation = objImprovementManager.SelectedValue;
			}

			// Create the TreeNode for the new item.
			objNode.Text = DisplayName;
			objNode.Tag = _guiID.ToString();

			// If we've just added a new base item, see if there are any subsystems that should automatically be added.
			if (objXmlCyberware.InnerXml.Contains("subsystems") && blnCreateChildren)
			{
				XmlDocument objXmlDocument = new XmlDocument();
				if (objSource == Improvement.ImprovementSource.Bioware)
					objXmlDocument = XmlManager.Instance.Load("bioware.xml");
				else
					objXmlDocument = XmlManager.Instance.Load("cyberware.xml");

				XmlNodeList objXmlSubsystemList;
				if (objSource == Improvement.ImprovementSource.Bioware)
					objXmlSubsystemList = objXmlDocument.SelectNodes("/chummer/biowares/bioware[capacity = \"[*]\" and contains(\"" + _strSubsystems + "\", category)]");
				else
					objXmlSubsystemList = objXmlDocument.SelectNodes("/chummer/cyberwares/cyberware[capacity = \"[*]\" and contains(\"" + _strSubsystems + "\", category)]");
				foreach (XmlNode objXmlSubsystem in objXmlSubsystemList)
				{
					Cyberware objSubsystem = new Cyberware(objCharacter);
					objSubsystem.Name = objXmlSubsystem["name"].InnerText;
					objSubsystem.Category = objXmlSubsystem["category"].InnerText;
					objSubsystem.Grade = objGrade;
					objSubsystem.Rating = 0;
					objSubsystem.ESS = objXmlSubsystem["ess"].InnerText;
					objSubsystem.Capacity = objXmlSubsystem["capacity"].InnerText;
					objSubsystem.Avail = objXmlSubsystem["avail"].InnerText;
					objSubsystem.Cost = objXmlSubsystem["cost"].InnerText;
					objSubsystem.Source = objXmlSubsystem["source"].InnerText;
					objSubsystem.Page = objXmlSubsystem["page"].InnerText;
					objSubsystem.Bonus = objXmlSubsystem["bonus"];
					try
					{
						objSubsystem.MaxRating = Convert.ToInt32(objXmlCyberware["rating"].InnerText);
					}
					catch
					{
						objSubsystem.MaxRating = 0;
					}

					// If there are any bonuses, create the Improvements for them.
					if (objXmlSubsystem["bonus"] != null)
					{
						ImprovementManager objImprovementManager = new ImprovementManager(objCharacter);
						if (!objImprovementManager.CreateImprovements(objSource, objSubsystem.InternalId, objXmlSubsystem.SelectSingleNode("bonus"), false, 1, objSubsystem.DisplayNameShort))
						{
							objSubsystem._guiID = Guid.Empty;
							return;
						}
					}

					objSubsystem.Parent = this;

					_objChildren.Add(objSubsystem);

					ITreeNodeView objSubsystemNode = objNode.NewNode();
					objSubsystemNode.Text = objSubsystem.DisplayName;
					objSubsystemNode.Tag = objSubsystem.InternalId;
					objSubsystemNode.ShowAsGrayText();
					objNode.Add(objSubsystemNode);
					objNode.Expand();
				}
			}
		}

		/// <summary>
		/// Save the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Save(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("cyberware");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("limbslot", _strLimbSlot);
			objWriter.WriteElementString("ess", _strESS);
			objWriter.WriteElementString("capacity", _strCapacity);
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _strCost);
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("minrating", _intMinRating.ToString());
			objWriter.WriteElementString("maxrating", _intMaxRating.ToString());
			objWriter.WriteElementString("subsystems", _strSubsystems);
			objWriter.WriteElementString("grade", _objGrade.Name);
			objWriter.WriteElementString("location", _strLocation);
			objWriter.WriteElementString("suite", _blnSuite.ToString());
			objWriter.WriteElementString("essdiscount", _intEssenceDiscount.ToString());
			objWriter.WriteElementString("forcegrade", _strForceGrade);
			if (_nodBonus != null)
				objWriter.WriteRaw(_nodBonus.OuterXml);
			else
				objWriter.WriteElementString("bonus", "");
			if (_nodAllowGear != null)
				objWriter.WriteRaw(_nodAllowGear.OuterXml);
			objWriter.WriteElementString("improvementsource", _objImprovementSource.ToString());
			if (_guiWeaponID != Guid.Empty)
				objWriter.WriteElementString("weaponguid", _guiWeaponID.ToString());
			objWriter.WriteStartElement("children");
			foreach (Cyberware objChild in _objChildren)
			{
				objChild.Save(objWriter);
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
			Improvement objImprovement = new Improvement();
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strCategory = objNode["category"].InnerText;
			try
			{
				_strLimbSlot = objNode["limbslot"].InnerText;
			}
			catch
			{
			}
			_strESS = objNode["ess"].InnerText;
			_strCapacity = objNode["capacity"].InnerText;
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

			_intRating = Convert.ToInt32(objNode["rating"].InnerText);
			try
			{
				_intMinRating = Convert.ToInt32(objNode["minrating"].InnerText);
			}
			catch
			{
			}
			_intMaxRating = Convert.ToInt32(objNode["maxrating"].InnerText);
			_strSubsystems = objNode["subsystems"].InnerText;
			_objGrade = ConvertToCyberwareGrade(objNode["grade"].InnerText, _objImprovementSource);
			try
			{
				_strLocation = objNode["location"].InnerText;
			}
			catch
			{
			}
			try
			{
				_blnSuite = Convert.ToBoolean(objNode["suite"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intEssenceDiscount = Convert.ToInt32(objNode["essdiscount"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strForceGrade = objNode["forcegrade"].InnerText;
			}
			catch
			{
			}
			_nodBonus = objNode["bonus"];
			try
			{
				_nodAllowGear = objNode["allowgear"];
			}
			catch
			{
			}
			_objImprovementSource = objImprovement.ConvertToImprovementSource(objNode["improvementsource"].InnerText);
			try
			{
				_guiWeaponID = Guid.Parse(objNode["weaponguid"].InnerText);
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				string strXmlFile = "";
				string strXPath = "";
				if (_objImprovementSource == Improvement.ImprovementSource.Bioware)
				{
					strXmlFile = "bioware.xml";
					strXPath = "/chummer/biowares/bioware";
				}
				else
				{
					strXmlFile = "cyberware.xml";
					strXPath = "/chummer/cyberwares/cyberware";
				}
				XmlDocument objXmlDocument = XmlManager.Instance.Load(strXmlFile);
				XmlNode objCyberwareNode = objXmlDocument.SelectSingleNode(strXPath + "[name = \"" + _strName + "\"]");
				if (objCyberwareNode != null)
				{
					if (objCyberwareNode["translate"] != null)
						_strAltName = objCyberwareNode["translate"].InnerText;
					if (objCyberwareNode["altpage"] != null)
						_strAltPage = objCyberwareNode["altpage"].InnerText;
				}

				objCyberwareNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objCyberwareNode != null)
				{
					if (objCyberwareNode.Attributes["translate"] != null)
						_strAltCategory = objCyberwareNode.Attributes["translate"].InnerText;
				}
			}

			if (objNode.InnerXml.Contains("<cyberware>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("children/cyberware");
				foreach (XmlNode nodChild in nodChildren)
				{
					Cyberware objChild = new Cyberware(_objCharacter);
					objChild.Load(nodChild, blnCopy);
					objChild.Parent = this;
					_objChildren.Add(objChild);
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
			objWriter.WriteStartElement("cyberware");
			if (_strLimbSlot == "")
				objWriter.WriteElementString("name", DisplayNameShort);
			else
				objWriter.WriteElementString("name", DisplayNameShort + " (" + LanguageManager.Instance.GetString("String_AttributeBODShort") + " " + TotalBody.ToString() + ", " + LanguageManager.Instance.GetString("String_AttributeAGIShort") + " " + TotalAgility.ToString() + ", " + LanguageManager.Instance.GetString("String_AttributeSTRShort") + " " + TotalStrength.ToString() + ")");
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("ess", CalculatedESS.ToString());
			objWriter.WriteElementString("capacity", _strCapacity);
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			try
			{
				objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			}
			catch
			{
				objWriter.WriteElementString("source", _strSource);
			}
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("minrating", _intMinRating.ToString());
			objWriter.WriteElementString("maxrating", _intMaxRating.ToString());
			objWriter.WriteElementString("subsystems", _strSubsystems);
			objWriter.WriteElementString("grade", _objGrade.DisplayName);
			objWriter.WriteElementString("location", _strLocation);
			objWriter.WriteElementString("improvementsource", _objImprovementSource.ToString());
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
			}
			objWriter.WriteStartElement("children");
			foreach (Cyberware objChild in _objChildren)
			{
				objChild.Print(objWriter);
			}
			objWriter.WriteEndElement();
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this piece of Cyberware in the Improvement system.
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
		/// AllowGear node from the XML file.
		/// </summary>
		public XmlNode AllowGear
		{
			get
			{
				return _nodAllowGear;
			}
			set
			{
				_nodAllowGear = value;
			}
		}

		/// <summary>
		/// ImprovementSource Type.
		/// </summary>
		public Improvement.ImprovementSource SourceType
		{
			get
			{
				return _objImprovementSource;
			}
			set
			{
				_objImprovementSource = value;
			}
		}

		/// <summary>
		/// Cyberware name.
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

				if (_intRating > 0)
					strReturn += " (" + LanguageManager.Instance.GetString("String_Rating") + " " + _intRating.ToString() + ")";
				if (_strLocation != "")
				{
					LanguageManager.Instance.Load(GlobalOptions.Instance.Language, this);
					// Attempt to retrieve the Attribute name.
					try
					{
						if (LanguageManager.Instance.GetString("String_Attribute" + _strLocation + "Short") != "")
							strReturn += " (" + LanguageManager.Instance.GetString("String_Attribute" + _strLocation + "Short") + ")";
						else
							strReturn += " (" + LanguageManager.Instance.TranslateExtra(_strLocation) + ")";
					}
					catch
					{
						strReturn += " (" + LanguageManager.Instance.TranslateExtra(_strLocation) + ")";
					}
				}
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
		/// Cyberware category.
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
		/// The body "slot" a Cyberlimb occupies.
		/// </summary>
		public string LimbSlot
		{
			get
			{
				return _strLimbSlot;
			}
			set
			{
				_strLimbSlot = value;
			}
		}

		/// <summary>
		/// The location of a Cyberlimb.
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
		/// Essence cost of the Cyberware.
		/// </summary>
		public string ESS
		{
			get
			{
				return _strESS;
			}
			set
			{
				_strESS = value;
			}
		}

		/// <summary>
		/// Cyberware capacity.
		/// </summary>
		public string Capacity
		{
			get
			{
				return _strCapacity;
			}
			set
			{
				_strCapacity = value;
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
		/// Minimum Rating.
		/// </summary>
		public int MinRating
		{
			get
			{
				return _intMinRating;
			}
			set
			{
				_intMinRating = value;
			}
		}

		/// <summary>
		/// Maximum Rating.
		/// </summary>
		public int MaxRating
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
		/// Grade level of the Cyberware.
		/// </summary>
		public Grade Grade
		{
			get
			{
				return _objGrade;
			}
			set
			{
				_objGrade = value;
			}
		}

		/// <summary>
		/// The Categories of allowable Subsystems.
		/// </summary>
		public string Subsytems
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
		/// Whether or not the piece of Cyberware is part of a Cyberware Suite.
		/// </summary>
		public bool Suite
		{
			get
			{
				return _blnSuite;
			}
			set
			{
				_blnSuite = value;
			}
		}

		/// <summary>
		/// Essence cost discount.
		/// </summary>
		public int ESSDiscount
		{
			get
			{
				return _intEssenceDiscount;
			}
			set
			{
				_intEssenceDiscount = value;
			}
		}

		/// <summary>
		/// A List of child pieces of Cyberware.
		/// </summary>
		public List<Cyberware> Children
		{
			get
			{
				return _objChildren;
			}
		}

		/// <summary>
		/// A List of the Gear attached to the Cyberware.
		/// </summary>
		public List<Gear> Gear
		{
			get
			{
				return _lstGear;
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
		/// Whether or not the Cyberware's cost should be discounted by 10% through the Black Market Pipeline Quality.
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
		/// Parent Cyberware.
		/// </summary>
		public Cyberware Parent
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

		/// <summary>
		/// Grade that the Cyberware should be forced to use, if applicable.
		/// </summary>
		public string ForceGrade
		{
			get
			{
				return _strForceGrade;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// Total Availablility of the Cyberware and its plugins.
		/// </summary>
		public string TotalAvail
		{
			get
			{
				// If the Avail starts with "+", return the base string and don't try to calculate anything since we're looking at a child component.
				if (_strAvail.StartsWith("+"))
				{
					if (_strAvail.Contains("Rating"))
					{
						// If the availability is determined by the Rating, evaluate the expression.
						XmlDocument objXmlDocument = new XmlDocument();
						XPathNavigator nav = objXmlDocument.CreateNavigator();

						string strAvail = "";
						string strAvailExpr = _strAvail.Substring(1, _strAvail.Length - 1);

						if (strAvailExpr.Substring(strAvailExpr.Length - 1, 1) == "F" || strAvailExpr.Substring(strAvailExpr.Length - 1, 1) == "R")
						{
							strAvail = strAvailExpr.Substring(strAvailExpr.Length - 1, 1);
							// Remove the trailing character if it is "F" or "R".
							strAvailExpr = strAvailExpr.Substring(0, strAvailExpr.Length - 1);
						}
						XPathExpression xprAvail = nav.Compile(strAvailExpr.Replace("Rating", _intRating.ToString()));
						return "+" + nav.Evaluate(xprAvail) + strAvail;
					}
					else
						return _strAvail;
				}

				string strCalculated = "";
				string strReturn = "";

				// Second Hand Cyberware has a reduced Availability.
				int intAvailModifier = 0;

				// Apply the Grade's Avail modifier.
				intAvailModifier = Grade.Avail;

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
					strCalculated = (Convert.ToInt32(nav.Evaluate(xprAvail)) + intAvailModifier).ToString() + strAvail;
				}
				else
				{
					if (_strAvail.StartsWith("FixedValues"))
					{
						string[] strValues = _strAvail.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						strCalculated = strValues[_intRating - 1];
					}
					else
					{
						// Just a straight cost, so return the value.
						string strAvail = "";
						if (_strAvail.Contains("F") || _strAvail.Contains("R"))
						{
							strAvail = _strAvail.Substring(_strAvail.Length - 1, 1);
							strCalculated = (Convert.ToInt32(_strAvail.Substring(0, _strAvail.Length - 1)) + intAvailModifier) + strAvail;
						}
						else
							strCalculated = (Convert.ToInt32(_strAvail) + intAvailModifier).ToString();
					}
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

				// Run through the child items and increase the Avail by any Mod whose Avail contains "+".
				foreach (Cyberware objChild in _objChildren)
				{
					if (objChild.Avail.Contains("+"))
					{
						string strChildAvail = objChild.Avail;
						if (objChild.Avail.Contains("Rating"))
						{
							strChildAvail = strChildAvail.Replace("Rating", objChild.Rating.ToString());
							string strChildAvailText = "";
							if (strChildAvail.Contains("R") || strChildAvail.Contains("F"))
							{
								strChildAvailText = strChildAvail.Substring(objChild.Avail.Length - 1);
								strChildAvail = strChildAvail.Replace(strChildAvailText, string.Empty);
							}

							// If the availability is determined by the Rating, evaluate the expression.
							XmlDocument objXmlDocument = new XmlDocument();
							XPathNavigator nav = objXmlDocument.CreateNavigator();

							string strChildAvailExpr = strChildAvail;

							// Remove the "+" since the expression can't be evaluated if it starts with this.
							XPathExpression xprAvail = nav.Compile(strChildAvailExpr.Replace("+", ""));
							strChildAvail = "+" + nav.Evaluate(xprAvail);
							if (strChildAvailText != "")
								strChildAvail += strChildAvailText;
						}

						if (strChildAvail.Contains("R") || strChildAvail.Contains("F"))
						{
							if (strAvailText != "F")
								strAvailText = strChildAvail.Substring(objChild.Avail.Length - 1);
							intAvail += Convert.ToInt32(strChildAvail.Replace("F", string.Empty).Replace("R", string.Empty));
						}
						else
							intAvail += Convert.ToInt32(strChildAvail);
					}
				}

				// Avail cannot go below 0. This typically happens when an item with Avail 0 is given the Second Hand category.
				if (intAvail < 0)
					intAvail = 0;

				strReturn = intAvail.ToString() + strAvailText;

				// Translate the Avail string.
				strReturn = strReturn.Replace("R", LanguageManager.Instance.GetString("String_AvailRestricted"));
				strReturn = strReturn.Replace("F", LanguageManager.Instance.GetString("String_AvailForbidden"));

				return strReturn;
			}
		}

		/// <summary>
		/// Caculated Capacity of the Cyberware.
		/// </summary>
		public string CalculatedCapacity
		{
			get
			{
				if (_strCapacity.Contains("/["))
				{
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					int intPos = _strCapacity.IndexOf("/[");
					string strFirstHalf = _strCapacity.Substring(0, intPos);
					string strSecondHalf = _strCapacity.Substring(intPos + 1, _strCapacity.Length - intPos - 1);
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
						if (_strCapacity == "[*]")
							strReturn = "*";
						else
						{
							if (_strCapacity.StartsWith("FixedValues"))
							{
								string[] strValues = _strCapacity.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
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

					if (strSecondHalf.Contains("Rating"))
					{
						strSecondHalf = strSecondHalf.Replace("[", string.Empty).Replace("]", string.Empty);
						xprCapacity = nav.Compile(strSecondHalf.Replace("Rating", _intRating.ToString()));
						strSecondHalf = "[" + nav.Evaluate(xprCapacity).ToString() + "]";
					}

					strReturn += "/" + strSecondHalf;
					return strReturn;
				}
				else if (_strCapacity.Contains("Rating"))
				{
					// If the Capaicty is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					// XPathExpression cannot evaluate while there are square brackets, so remove them if necessary.
					bool blnSquareBrackets = _strCapacity.Contains('[');
					string strCapacity = _strCapacity;
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
					if (_strCapacity.StartsWith("FixedValues"))
					{
						string[] strValues = _strCapacity.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						return strValues[_intRating - 1];
					}
					else
					{
						// Just a straight Capacity, so return the value.
						return _strCapacity;
					}
				}
			}
		}

		/// <summary>
		/// Calculated Essence cost of the Cyberware.
		/// </summary>
		public decimal CalculatedESS
		{
			get
			{
				decimal decReturn = 0;
				decimal decESSMultiplier = 0;

				if (_strESS.Contains("Rating"))
				{
					// If the cost is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strEss = "";
					string strEssExpression = _strESS;

					strEss = strEssExpression.Replace("Rating", _intRating.ToString());
					XPathExpression xprEss = nav.Compile(strEss);
					decReturn = Convert.ToDecimal(nav.Evaluate(xprEss), GlobalOptions.Instance.CultureInfo);
				}
				else
				{
					if (_strESS.StartsWith("FixedValues"))
					{
						string[] strValues = _strESS.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						decReturn = Convert.ToDecimal(strValues[_intRating - 1], GlobalOptions.Instance.CultureInfo);
					}
					else
					{
						// Just a straight cost, so return the value.
						decReturn = Convert.ToDecimal(_strESS, GlobalOptions.Instance.CultureInfo);
					}
				}

				// Factor in the Essence multiplier of the selected CyberwareGrade.
				decESSMultiplier = Grade.Essence;

				if (_blnSuite)
					decESSMultiplier -= 0.1m;

				if (_intEssenceDiscount != 0)
				{
					decimal decDiscount = Convert.ToDecimal(_intEssenceDiscount, GlobalOptions.Instance.CultureInfo) * 0.01m;
					decESSMultiplier -= decDiscount;
				}

				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);

				// Retrieve the Bioware or Cyberware ESS Cost Multiplier. Bioware Modifiers do not apply to Genetech.
				double dblMultiplier = 1;
				double dblCharacterESSMultiplier = 1;
				double dblBasicBiowareESSMultiplier = 1;
				// Apply the character's Cyberware Essence cost multiplier if applicable.
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.CyberwareEssCost) != 0 && _objImprovementSource == Improvement.ImprovementSource.Cyberware)
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.CyberwareEssCost && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
					dblCharacterESSMultiplier = dblMultiplier;
				}

				// Apply the character's Bioware Essence cost multiplier if applicable.
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.BiowareEssCost) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware)
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.BiowareEssCost && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
					dblCharacterESSMultiplier = dblMultiplier;
				}

				// Apply the character's Basic Bioware Essence cost multiplier if applicable.
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.BasicBiowareEssCost) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware)
				{
					double dblBasicMultiplier = 1;
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.BasicBiowareEssCost && objImprovement.Enabled)
							dblBasicMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
					dblBasicBiowareESSMultiplier = dblBasicMultiplier;
				}

				if (_strCategory.StartsWith("Genetech") || _strCategory.StartsWith("Genetic Infusions"))
					dblCharacterESSMultiplier = 1;

				if (_strCategory == "Basic")
					dblCharacterESSMultiplier -= (1 - dblBasicBiowareESSMultiplier);

				dblCharacterESSMultiplier -= (1 - Convert.ToDouble(decESSMultiplier, GlobalOptions.Instance.CultureInfo));

				decReturn = decReturn * Convert.ToDecimal(dblCharacterESSMultiplier, GlobalOptions.Instance.CultureInfo);

				// Check if the character has Sensitive System.
				if (_objImprovementSource == Improvement.ImprovementSource.Cyberware)
				{
					try
					{
						foreach (Improvement objImprovement in _objCharacter.Improvements)
						{
							if (objImprovement.ImproveType == Improvement.ImprovementType.SensitiveSystem && objImprovement.Enabled)
								decReturn *= 2.0m;
						}
					}
					catch
					{
						// The try/catch block is here because Cyberware plugins can be added to the Mechanical Arms of Vehicles which does not affect the character itself.
					}
				}

				decReturn = Math.Round(decReturn, _objCharacter.Options.EssenceDecimals, MidpointRounding.AwayFromZero);

				return decReturn;
			}
		}

		/// <summary>
		/// Total cost of the Cyberware and its plugins.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intCost = 0;
				int intReturn = 0;

				if (_strCost.Contains("Rating"))
				{
					// If the cost is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCost = "";
					string strCostExpression = _strCost;

					strCost = strCostExpression.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCost);
					intCost = Convert.ToInt32(nav.Evaluate(xprCost).ToString());
				}
				else
				{
					if (_strCost.StartsWith("FixedValues"))
					{
						string[] strValues = _strCost.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						intCost = Convert.ToInt32(strValues[_intRating - 1], GlobalOptions.Instance.CultureInfo);
					}
					else
					{
						// Just a straight cost, so return the value.
						try
						{
							intCost = Convert.ToInt32(_strCost);
						}
						catch
						{
							intCost = 0;
						}
					}
				}

				// Factor in the Cost multiplier of the selected CyberwareGrade.
				intCost = Convert.ToInt32(Convert.ToDouble(intCost, GlobalOptions.Instance.CultureInfo) * Grade.Cost);

				intReturn = intCost;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Add in the cost of all child components.
				foreach (Cyberware objChild in _objChildren)
				{
					if (objChild.Capacity != "[*]")
					{
						// If the child cost starts with "*", multiply the item's base cost.
						if (objChild.Cost.StartsWith("*"))
						{
							int intPluginCost = 0;
							string strMultiplier = objChild.Cost;
							strMultiplier = strMultiplier.Replace("*", string.Empty);
							intPluginCost = Convert.ToInt32(intCost * (Convert.ToDouble(strMultiplier, GlobalOptions.Instance.CultureInfo) - 1));

							if (objChild.DiscountCost)
								intPluginCost = Convert.ToInt32(Convert.ToDouble(intPluginCost, GlobalOptions.Instance.CultureInfo) * 0.9);
							
							intReturn += intPluginCost;
						}
						else
							intReturn += objChild.TotalCostWithoutModifiers;
					}

					// Add in the cost of any Plugin Gear plugins.
					foreach (Gear objGear in objChild.Gear)
						intReturn += objGear.TotalCost;
				}

				// Add in the cost of all Gear plugins.
				foreach (Gear objGear in _lstGear)
				{
					intReturn += objGear.TotalCost;
				}

				// Retrieve the Genetech Cost Multiplier if available.
				double dblMultiplier = 1;
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.GenetechCostMultiplier) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware && _strCategory.StartsWith("Genetech"))
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.GenetechCostMultiplier && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
				}

				// Retrieve the Transgenics Cost Multiplier if available.
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.TransgenicsBiowareCost) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware && _strCategory == "Genetech: Transgenics")
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.TransgenicsBiowareCost && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
				}

				if (dblMultiplier == 0)
					dblMultiplier = 1;

				double dblSuiteMultiplier = 1.0;
				if (_blnSuite)
					dblSuiteMultiplier = 0.9;

				return Convert.ToInt32(Math.Round((Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * Convert.ToDouble(dblMultiplier, GlobalOptions.Instance.CultureInfo) * dblSuiteMultiplier), 2, MidpointRounding.AwayFromZero));
			}
		}

		/// <summary>
		/// Identical to TotalCost, but without the Improvement and Suite multpliers which would otherwise be doubled.
		/// </summary>
		private int TotalCostWithoutModifiers
		{
			get
			{
				int intCost = 0;
				int intReturn = 0;

				if (_strCost.Contains("Rating"))
				{
					// If the cost is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCost = "";
					string strCostExpression = _strCost;

					strCost = strCostExpression.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCost);
					intCost = Convert.ToInt32(nav.Evaluate(xprCost).ToString());
				}
				else
				{
					if (_strCost.StartsWith("FixedValues"))
					{
						string[] strValues = _strCost.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						intCost = Convert.ToInt32(strValues[_intRating - 1], GlobalOptions.Instance.CultureInfo);
					}
					else
					{
						// Just a straight cost, so return the value.
						try
						{
							intCost = Convert.ToInt32(_strCost);
						}
						catch
						{
							intCost = 0;
						}
					}
				}

				// Factor in the Cost multiplier of the selected CyberwareGrade.
				intCost = Convert.ToInt32(Convert.ToDouble(intCost, GlobalOptions.Instance.CultureInfo) * Grade.Cost);

				intReturn = intCost;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				const double dblMultiplier = 1;
				const double decSuiteMultiplier = 1.0;

				return Convert.ToInt32(Math.Round((Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * Convert.ToDouble(dblMultiplier, GlobalOptions.Instance.CultureInfo) * decSuiteMultiplier), 2, MidpointRounding.AwayFromZero));
			}
		}

		/// <summary>
		/// Cost of just the Cyberware itself.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intCost = 0;
				int intReturn = 0;

				if (_strCost.Contains("Rating"))
				{
					// If the cost is determined by the Rating, evaluate the expression.
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCost = "";
					string strCostExpression = _strCost;

					strCost = strCostExpression.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCost);
					intCost = Convert.ToInt32(nav.Evaluate(xprCost).ToString());
				}
				else
				{
					if (_strCost.StartsWith("FixedValues"))
					{
						string[] strValues = _strCost.Replace("FixedValues(", string.Empty).Replace(")", string.Empty).Split(',');
						intCost = Convert.ToInt32(strValues[_intRating - 1], GlobalOptions.Instance.CultureInfo);
					}
					else
					{
						// Just a straight cost, so return the value.
						try
						{
							intCost = Convert.ToInt32(_strCost);
						}
						catch
						{
							intCost = 0;
						}
					}
				}

				// Factor in the Cost multiplier of the selected CyberwareGrade.
				intCost = Convert.ToInt32(Convert.ToDouble(intCost, GlobalOptions.Instance.CultureInfo) * Grade.Cost);

				intReturn = intCost;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Retrieve the Genetech Cost Multiplier if available.
				double dblMultiplier = 1;
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.GenetechCostMultiplier) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware && _strCategory.StartsWith("Genetech"))
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.GenetechCostMultiplier && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
				}

				// Retrieve the Transgenics Cost Multiplier if available.
				if (objImprovementManager.ValueOf(Improvement.ImprovementType.TransgenicsBiowareCost) != 0 && _objImprovementSource == Improvement.ImprovementSource.Bioware && _strCategory == "Genetech: Transgenics")
				{
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.TransgenicsBiowareCost && objImprovement.Enabled)
							dblMultiplier -= (1 - (Convert.ToDouble(objImprovement.Value, GlobalOptions.Instance.CultureInfo) / 100));
					}
				}

				if (dblMultiplier == 0)
					dblMultiplier = 1;

				double dblSuiteMultiplier = 1.0;
				if (_blnSuite)
					dblSuiteMultiplier = 0.9;

				return Convert.ToInt32(Math.Round((Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * Convert.ToDouble(dblMultiplier, GlobalOptions.Instance.CultureInfo) * dblSuiteMultiplier), 2, MidpointRounding.AwayFromZero));
			}
		}

		/// <summary>
		/// The amount of Capacity remaining in the Cyberware.
		/// </summary>
		public int CapacityRemaining
		{
			get
			{
				int intCapacity = 0;
				if (_strCapacity.Contains("/["))
				{
					// Get the Cyberware base Capacity.
					string strBaseCapacity = CalculatedCapacity;
					strBaseCapacity = strBaseCapacity.Substring(0, strBaseCapacity.IndexOf('/'));
					intCapacity = Convert.ToInt32(strBaseCapacity);

					// Run through its Children and deduct the Capacity costs.
					foreach (Cyberware objChildCyberware in Children)
					{
						string strCapacity = objChildCyberware.CalculatedCapacity;
						if (strCapacity.Contains("/["))
							strCapacity = strCapacity.Substring(strCapacity.IndexOf('[') + 1, strCapacity.IndexOf(']') - strCapacity.IndexOf('[') - 1);
						else if (strCapacity.Contains("["))
							strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
						if (strCapacity == "*")
							strCapacity = "0";
						intCapacity -= Convert.ToInt32(strCapacity);
					}

				}
				else if (!_strCapacity.Contains("["))
				{
					// Get the Cyberware base Capacity.
					intCapacity = Convert.ToInt32(CalculatedCapacity);

					// Run through its Children and deduct the Capacity costs.
					foreach (Cyberware objChildCyberware in Children)
					{
						string strCapacity = objChildCyberware.CalculatedCapacity;
						if (strCapacity.Contains("/["))
							strCapacity = strCapacity.Substring(strCapacity.IndexOf('[') + 1, strCapacity.IndexOf(']') - strCapacity.IndexOf('[') - 1);
						else if (strCapacity.Contains("["))
							strCapacity = strCapacity.Substring(1, strCapacity.Length - 2);
						if (strCapacity == "*")
							strCapacity = "0";
						intCapacity -= Convert.ToInt32(strCapacity);
					}
				}
				
				return intCapacity;
			}
		}

		/// <summary>
		/// Cyberlimb Strength.
		/// </summary>
		public int TotalStrength
		{
			get
			{
				if (_strCategory != "Cyberlimb")
					return 0;

				// Base Strength for any limb is 3.
				int intAttribute = 3;
				int intBonus = 0;

				foreach (Cyberware objChild in _objChildren)
				{
					// If the limb has Customized Strength, this is its new base value.
					if (objChild.Name == "Customized Strength")
						intAttribute = objChild.Rating;
					// If the limb has Enhanced Strength, this adds to the limb's value.
					if (objChild.Name == "Enhanced Strength")
						intBonus = objChild.Rating;
				}

				return intAttribute + intBonus;
			}
		}

		/// <summary>
		/// Cyberlimb Body.
		/// </summary>
		public int TotalBody
		{
			get
			{
				if (_strCategory != "Cyberlimb")
					return 0;

				// Base Strength for any limb is 3.
				int intAttribute = 3;
				int intBonus = 0;

				foreach (Cyberware objChild in _objChildren)
				{
					// If the limb has Customized Body, this is its new base value.
					if (objChild.Name == "Customized Body")
						intAttribute = objChild.Rating;
					// If the limb has Enhanced Body, this adds to the limb's value.
					if (objChild.Name == "Enhanced Body")
						intBonus = objChild.Rating;
				}

				return intAttribute + intBonus;
			}
		}

		/// <summary>
		/// Cyberlimb Agility.
		/// </summary>
		public int TotalAgility
		{
			get
			{
				if (_strCategory != "Cyberlimb")
					return 0;

				// Base Strength for any limb is 3.
				int intAttribute = 3;
				int intBonus = 0;

				foreach (Cyberware objChild in _objChildren)
				{
					// If the limb has Customized Agility, this is its new base value.
					if (objChild.Name == "Customized Agility")
						intAttribute = objChild.Rating;
					// If the limb has Enhanced Agility, this adds to the limb's value.
					if (objChild.Name == "Enhanced Agility")
						intBonus = objChild.Rating;
				}

				return intAttribute + intBonus;
			}
		}

		/// <summary>
		/// Whether or not the Cyberware is allowed to accept Modular Plugins.
		/// </summary>
		public bool AllowModularPlugins
		{
			get
			{
				bool blnReturn = false;
				foreach (Cyberware objChild in _objChildren)
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
}