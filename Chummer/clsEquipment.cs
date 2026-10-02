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
	public class Equipment
	{
		public List<Armor> Armors = new List<Armor>();
		public List<ArmorMod> ArmorMods = new List<ArmorMod>();
		public List<Cyberware> Cyberwares = new List<Cyberware>();
		public List<Gear> Gears = new List<Gear>();
		public List<Vehicle> Vehicles = new List<Vehicle>();
		public List<VehicleMod> VehicleMods = new List<VehicleMod>();
		public List<Weapon> Weapons = new List<Weapon>();
		public List<WeaponAccessory> WeaponAccessories = new List<WeaponAccessory>();
		public List<WeaponMod> WeaponMods = new List<WeaponMod>();
	}

	/// <summary>
	/// A Weapon.
	/// </summary>
	public class Weapon : IImprovementWeapon, IEquipmentWeapon
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strCategory = "";
		private string _strType = "";
		private int _intReach = 0;
		private string _strDamage = "";
		private string _strAP = "0";
		private string _strMode = "";
		private string _strRC = "";
		private string _strAmmo = "";
		private string _strAmmoCategory = "";
		private int _intConceal = 0;
		private int _intAmmoRemaining = 0;
		private int _intAmmoRemaining2 = 0;
		private int _intAmmoRemaining3 = 0;
		private int _intAmmoRemaining4 = 0;
		private Guid _guiAmmoLoaded = new Guid();
		private Guid _guiAmmoLoaded2 = new Guid();
		private Guid _guiAmmoLoaded3 = new Guid();
		private Guid _guiAmmoLoaded4 = new Guid();
		private int _intActiveAmmoSlot = 1;
		private string _strAvail = "";
		private int _intCost = 0;
		private string _strRange = "";
		private double _dblRangeMultiplier = 1;
		private string _strSource = "";
		private string _strPage = "";
		private string _strWeaponName = "";
		private int _intFullBurst = 10;
		private int _intSuppressive = 20;
		private List<WeaponAccessory> _lstAccessories = new List<WeaponAccessory>();
		private List<WeaponMod> _lstWeaponMods = new List<WeaponMod>();
		private List<Weapon> _lstUnderbarrel = new List<Weapon>();
		private bool _blnUnderbarrel = false;
		private bool _blnVehicleMounted = false;
		private string _strNotes = "";
		private string _strAltName = "";
		private string _strAltCategory = "";
		private string _strAltPage = "";
		private string _strUseSkill = "";
		private string _strLocation = "";
		private string _strSpec = "";
		private string _strSpec2 = "";
		private bool _blnIncludedInWeapon = false;
		private bool _blnInstalled = true;
		private bool _blnDiscountCost = false;
		private bool _blnRequireAmmo = true;

		private readonly Character _objCharacter;

		#region Constructor, Create, Save, Load, and Print Methods
		public Weapon(Character objCharacter)
		{
			// Create the GUID for the new Weapon.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Weapon from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlWeapon">XmlNode to create the object from.</param>
		/// <param name="objCharacter">Character that the Weapon is being added to.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="cmsWeapon">ContextMenuStrip to use for Weapons.</param>
		/// <param name="cmsWeaponAccessory">ContextMenuStrip to use for Accessories.</param>
		/// <param name="cmsWeaponMod">ContextMenuStrip to use for Weapon Mods.</param>
		/// <param name="blnCreateChildren">Whether or not child items should be created.</param>
		public void Create(XmlNode objXmlWeapon, Character objCharacter, TreeNode objNode, ContextMenuStrip cmsWeapon, ContextMenuStrip cmsWeaponAccessory, ContextMenuStrip cmsWeaponMod, bool blnCreateChildren = true)
		{
			_strName = objXmlWeapon["name"].InnerText;
			_strCategory = objXmlWeapon["category"].InnerText;
			_strType = objXmlWeapon["type"].InnerText;
			_intReach = Convert.ToInt32(objXmlWeapon["reach"].InnerText);
			_strDamage = objXmlWeapon["damage"].InnerText;
			_strAP = objXmlWeapon["ap"].InnerText;
			_strMode = objXmlWeapon["mode"].InnerText;
			_strAmmo = objXmlWeapon["ammo"].InnerText;
			try
			{
				_strAmmoCategory = objXmlWeapon["ammocategory"].InnerText;
			}
			catch
			{
			}
			_strRC = objXmlWeapon["rc"].InnerText;
			try
			{
				_intConceal = Convert.ToInt32(objXmlWeapon["conceal"].InnerText);
			}
			catch
			{
			}
			_strAvail = objXmlWeapon["avail"].InnerText;
			_intCost = Convert.ToInt32(objXmlWeapon["cost"].InnerText);
			_strSource = objXmlWeapon["source"].InnerText;
			_strPage = objXmlWeapon["page"].InnerText;

			XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlNode objWeaponNode = objXmlDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + _strName + "\"]");
				if (objWeaponNode != null)
				{
					if (objWeaponNode["translate"] != null)
						_strAltName = objWeaponNode["translate"].InnerText;
					if (objWeaponNode["altpage"] != null)
						_strAltPage = objWeaponNode["altpage"].InnerText;
				}

				objWeaponNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objWeaponNode != null)
				{
					if (objWeaponNode.Attributes["translate"] != null)
						_strAltCategory = objWeaponNode.Attributes["translate"].InnerText;
				}
			}

			// Populate the Range if it differs from the Weapon's Category.
			if (objXmlWeapon["range"] != null)
			{
				_strRange = objXmlWeapon["range"].InnerText;
				if (objXmlWeapon["range"].Attributes["multiply"] != null)
					_dblRangeMultiplier = Convert.ToDouble(objXmlWeapon["range"].Attributes["multiply"].InnerText, GlobalOptions.Instance.CultureInfo);
			}

			try
			{
				_intFullBurst = Convert.ToInt32(objXmlWeapon["fullburst"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSuppressive = Convert.ToInt32(objXmlWeapon["suppressive"].InnerText);
			}
			catch
			{
			}

			if (objXmlWeapon["useskill"] != null)
				_strUseSkill = objXmlWeapon["useskill"].InnerText;

			if (objXmlWeapon["requireammo"] != null)
				_blnRequireAmmo = Convert.ToBoolean(objXmlWeapon["requireammo"].InnerText);

			if (objXmlWeapon["spec"] != null)
				_strSpec = objXmlWeapon["spec"].InnerText;

			if (objXmlDocument["spec2"] != null)
				_strSpec2 = objXmlWeapon["spec2"].InnerText;

			objNode.Text = DisplayName;
			objNode.Tag = _guiID.ToString();

			// If the Weapon comes with an Underbarrel Weapon, add it.
			if (objXmlWeapon.InnerXml.Contains("<underbarrel>") && blnCreateChildren)
			{
				XmlNode objXmlUnderbarrel = objXmlWeapon.SelectSingleNode("underbarrel");
				Weapon objUnderbarrelWeapon = new Weapon(_objCharacter);
				TreeNode objUnderbarrelNode = new TreeNode();
				XmlNode objXmlWeaponNode = objXmlDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + objXmlUnderbarrel.InnerText + "\"]");
				objUnderbarrelWeapon.Create(objXmlWeaponNode, _objCharacter, objUnderbarrelNode, cmsWeapon, cmsWeaponAccessory, cmsWeaponMod);
				objUnderbarrelWeapon.IncludedInWeapon = true;
				objUnderbarrelWeapon.IsUnderbarrelWeapon = true;
				_lstUnderbarrel.Add(objUnderbarrelWeapon);
				objUnderbarrelNode.ContextMenuStrip = cmsWeapon;
				objNode.Nodes.Add(objUnderbarrelNode);
			}

			// If there are any Accessories that come with the Weapon, add them.
			if (objXmlWeapon.InnerXml.Contains("<accessories>") && blnCreateChildren)
			{
				XmlNodeList objXmlAccessoryList = objXmlWeapon.SelectNodes("accessories/accessory");
				foreach (XmlNode objXmlWeaponAccessory in objXmlAccessoryList)
				{
					XmlNode objXmlAccessory = objXmlDocument.SelectSingleNode("/chummer/accessories/accessory[name = \"" + objXmlWeaponAccessory.InnerText + "\"]");
					TreeNode objAccessoryNode = new TreeNode();
					WeaponAccessory objAccessory = new WeaponAccessory(_objCharacter);
					objAccessory.Create(objXmlAccessory, objAccessoryNode, objXmlAccessory["mount"].InnerText);
					objAccessory.IncludedInWeapon = true;
					objAccessory.Parent = this;
					objAccessoryNode.ContextMenuStrip = cmsWeaponAccessory;
					_lstAccessories.Add(objAccessory);

					objNode.Nodes.Add(objAccessoryNode);
					objNode.Expand();
				}
			}

			// If there are any Mods that come with the Weapon, add them.
			if (objXmlWeapon.InnerXml.Contains("<mods>") && blnCreateChildren)
			{
				XmlNodeList objXmlModList = objXmlWeapon.SelectNodes("mods/mod");
				foreach (XmlNode objXmlWeaponMod in objXmlModList)
				{
					TreeNode objModNode = new TreeNode();
					XmlNode objXmlMod = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + objXmlWeaponMod.InnerText + "\"]");
					WeaponMod objMod = new WeaponMod(_objCharacter);
					objMod.Create(objXmlMod, objModNode);
					objMod.IncludedInWeapon = true;
					objMod.Parent = this;
					objModNode.ContextMenuStrip = cmsWeaponMod;
					_lstWeaponMods.Add(objMod);

					if (objXmlWeaponMod.Attributes["rating"] != null)
						objMod.Rating = Convert.ToInt32(objXmlWeaponMod.Attributes["rating"].InnerText);

					objModNode.Text = objMod.DisplayName;

					objNode.Nodes.Add(objModNode);
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
			objWriter.WriteStartElement("weapon");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("category", _strCategory);
			objWriter.WriteElementString("type", _strType);
			objWriter.WriteElementString("spec", _strSpec);
			objWriter.WriteElementString("spec2", _strSpec2);
			objWriter.WriteElementString("reach", _intReach.ToString());
			objWriter.WriteElementString("damage", _strDamage);
			objWriter.WriteElementString("ap", _strAP);
			objWriter.WriteElementString("mode", _strMode);
			objWriter.WriteElementString("rc", _strRC);
			objWriter.WriteElementString("ammo", _strAmmo);
			objWriter.WriteElementString("ammocategory", _strAmmoCategory);
			objWriter.WriteElementString("ammoremaining", _intAmmoRemaining.ToString());
			objWriter.WriteElementString("ammoremaining2", _intAmmoRemaining2.ToString());
			objWriter.WriteElementString("ammoremaining3", _intAmmoRemaining3.ToString());
			objWriter.WriteElementString("ammoremaining4", _intAmmoRemaining4.ToString());
			objWriter.WriteElementString("ammoloaded", _guiAmmoLoaded.ToString());
			objWriter.WriteElementString("ammoloaded2", _guiAmmoLoaded2.ToString());
			objWriter.WriteElementString("ammoloaded3", _guiAmmoLoaded3.ToString());
			objWriter.WriteElementString("ammoloaded4", _guiAmmoLoaded4.ToString());
			objWriter.WriteElementString("conceal", _intConceal.ToString());
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _intCost.ToString());
			objWriter.WriteElementString("useskill", _strUseSkill);
			objWriter.WriteElementString("range", _strRange);
			objWriter.WriteElementString("rangemultiply", _dblRangeMultiplier.ToString(GlobalOptions.Instance.CultureInfo));
			objWriter.WriteElementString("fullburst", _intFullBurst.ToString());
			objWriter.WriteElementString("suppressive", _intSuppressive.ToString());
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
			objWriter.WriteElementString("weaponname", _strWeaponName);
			objWriter.WriteElementString("included", _blnIncludedInWeapon.ToString());
			objWriter.WriteElementString("installed", _blnInstalled.ToString());
			objWriter.WriteElementString("requireammo", _blnRequireAmmo.ToString());
			if (_lstAccessories.Count > 0)
			{
				objWriter.WriteStartElement("accessories");
				foreach (WeaponAccessory objAccessory in _lstAccessories)
					objAccessory.Save(objWriter);
				objWriter.WriteEndElement();
			}
			if (_lstWeaponMods.Count > 0)
			{
				objWriter.WriteStartElement("weaponmods");
				foreach (WeaponMod objMod in _lstWeaponMods)
					objMod.Save(objWriter);
				objWriter.WriteEndElement();
			}
			if (_lstUnderbarrel.Count > 0)
			{
				foreach (Weapon objUnderbarrel in _lstUnderbarrel)
				{
					objWriter.WriteStartElement("underbarrel");
					objUnderbarrel.Save(objWriter);
					objWriter.WriteEndElement();
				}
			}
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
			if (objNode["category"].InnerText == "Hold-Outs")
				objNode["category"].InnerText = "Holdouts";
			if (objNode["category"].InnerText == "Cyberware Hold-Outs")
				objNode["category"].InnerText = "Cyberware Holdouts";
			_strCategory = objNode["category"].InnerText;
			_strType = objNode["type"].InnerText;
			if (objNode["spec"] != null)
				_strSpec = objNode["spec"].InnerText;
			if (objNode["spec2"] != null)
				_strSpec2 = objNode["spec2"].InnerText;
			_intReach = Convert.ToInt32(objNode["reach"].InnerText);
			_strDamage = objNode["damage"].InnerText;
			_strAP = objNode["ap"].InnerText;
			_strMode = objNode["mode"].InnerText;
			_strRC = objNode["rc"].InnerText;
			_strAmmo = objNode["ammo"].InnerText;
			try
			{
				_strAmmoCategory = objNode["ammocategory"].InnerText;
			}
			catch
			{
			}
			try
			{
				_intAmmoRemaining = Convert.ToInt32(objNode["ammoremaining"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intAmmoRemaining2 = Convert.ToInt32(objNode["ammoremaining2"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intAmmoRemaining3 = Convert.ToInt32(objNode["ammoremaining3"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intAmmoRemaining4 = Convert.ToInt32(objNode["ammoremaining4"].InnerText);
			}
			catch
			{
			}
			try
			{
				_guiAmmoLoaded = Guid.Parse(objNode["ammoloaded"].InnerText);
			}
			catch
			{
			}
			try
			{
				_guiAmmoLoaded2 = Guid.Parse(objNode["ammoloaded2"].InnerText);
			}
			catch
			{
			}
			try
			{
				_guiAmmoLoaded3 = Guid.Parse(objNode["ammoloaded3"].InnerText);
			}
			catch
			{
			}
			try
			{
				_guiAmmoLoaded4 = Guid.Parse(objNode["ammoloaded4"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intConceal = Convert.ToInt32(objNode["conceal"].InnerText);
			}
			catch
			{
			}
			_strAvail = objNode["avail"].InnerText;
			_intCost = Convert.ToInt32(objNode["cost"].InnerText);
			try
			{
				_intFullBurst = Convert.ToInt32(objNode["fullburst"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSuppressive = Convert.ToInt32(objNode["suppressive"].InnerText);
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
				_strWeaponName = objNode["weaponname"].InnerText;
			}
			catch
			{
			}
			try
			{
				if (objNode["range"].InnerText == "Hold-Outs")
					objNode["range"].InnerText = "Holdouts";
				_strRange = objNode["range"].InnerText;
			}
			catch
			{
			}
			try
			{
				_strUseSkill = objNode["useskill"].InnerText;
			}
			catch
			{
			}
			try
			{
				_dblRangeMultiplier = Convert.ToDouble(objNode["rangemultiply"].InnerText, GlobalOptions.Instance.CultureInfo);
			}
			catch
			{
			}

			try
			{
				_blnIncludedInWeapon = Convert.ToBoolean(objNode["included"].InnerText);
			}
			catch
			{
			}
			try
			{
				_blnInstalled = Convert.ToBoolean(objNode["installed"].InnerText);
			}
			catch
			{
			}
			try
			{
				_blnRequireAmmo = Convert.ToBoolean(objNode["requireammo"].InnerText);
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objWeaponNode = objXmlDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + _strName + "\"]");
				if (objWeaponNode != null)
				{
					if (objWeaponNode["translate"] != null)
						_strAltName = objWeaponNode["translate"].InnerText;
					if (objWeaponNode["altpage"] != null)
						_strAltPage = objWeaponNode["altpage"].InnerText;
				}

				objWeaponNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
				if (objWeaponNode != null)
				{
					if (objWeaponNode.Attributes["translate"] != null)
						_strAltCategory = objWeaponNode.Attributes["translate"].InnerText;
				}
			}

			if (objNode.InnerXml.Contains("<accessories>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("accessories/accessory");
				foreach (XmlNode nodChild in nodChildren)
				{
					WeaponAccessory objAccessory = new WeaponAccessory(_objCharacter);
					objAccessory.Load(nodChild, blnCopy);
					objAccessory.Parent = this;
					_lstAccessories.Add(objAccessory);
				}
			}

			if (objNode.InnerXml.Contains("<weaponmods>"))
			{
				XmlNodeList nodChildren = objNode.SelectNodes("weaponmods/weaponmod");
				foreach (XmlNode nodChild in nodChildren)
				{
					WeaponMod objMod = new WeaponMod(_objCharacter);
					objMod.Load(nodChild, blnCopy);
					objMod.Parent = this;
					_lstWeaponMods.Add(objMod);
				}
			}

			if (objNode.InnerXml.Contains("<underbarrel>"))
			{
				foreach (XmlNode nodWeapon in objNode.SelectNodes("underbarrel/weapon"))
				{
					Weapon objUnderbarrel = new Weapon(_objCharacter);
					objUnderbarrel.Load(nodWeapon, blnCopy);
					objUnderbarrel.IsUnderbarrelWeapon = true;
					_lstUnderbarrel.Add(objUnderbarrel);
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
				_strLocation = objNode["location"].InnerText;
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
				_guiAmmoLoaded = Guid.Empty;
				_guiAmmoLoaded2 = Guid.Empty;
				_guiAmmoLoaded3 = Guid.Empty;
				_guiAmmoLoaded4 = Guid.Empty;
				_intActiveAmmoSlot = 1;
				_intAmmoRemaining = 0;
				_intAmmoRemaining2 = 0;
				_intAmmoRemaining3 = 0;
				_intAmmoRemaining4 = 0;
			}
		}

		/// <summary>
		/// Print the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Print(XmlTextWriter objWriter)
		{
			// Find the piece of Gear that created this item if applicable.
			CommonFunctions objFunctions = new CommonFunctions(_objCharacter);
			Gear objGear = objFunctions.FindGearByWeaponID(_guiID.ToString(), _objCharacter.Gear);

			objWriter.WriteStartElement("weapon");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("name_english", _strName);
			objWriter.WriteElementString("category", DisplayCategory);
			objWriter.WriteElementString("category_english", _strCategory);
			objWriter.WriteElementString("type", _strType);
			objWriter.WriteElementString("reach", TotalReach.ToString());
			objWriter.WriteElementString("damage", CalculatedDamage());
			objWriter.WriteElementString("damage_english", CalculatedDamage(0, true));
			objWriter.WriteElementString("rawdamage", _strDamage);
			objWriter.WriteElementString("ap", TotalAP);
			objWriter.WriteElementString("mode", CalculatedMode);
			objWriter.WriteElementString("rc", TotalRC);
			objWriter.WriteElementString("ammo", CalculatedAmmo());
			objWriter.WriteElementString("ammo_english", CalculatedAmmo(true));
			objWriter.WriteElementString("conceal", CalculatedConcealability());
			if (objGear != null)
			{
				objWriter.WriteElementString("avail", objGear.TotalAvail(true));
				objWriter.WriteElementString("cost", objGear.TotalCost.ToString());
				objWriter.WriteElementString("owncost", objGear.OwnCost.ToString());
			}
			else
			{
				objWriter.WriteElementString("avail", TotalAvail);
				objWriter.WriteElementString("cost", TotalCost.ToString());
				objWriter.WriteElementString("owncost", OwnCost.ToString());
			}
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			objWriter.WriteElementString("weaponname", _strWeaponName);
			objWriter.WriteElementString("location", _strLocation);
			if (_lstAccessories.Count > 0)
			{
				objWriter.WriteStartElement("accessories");
				foreach (WeaponAccessory objAccessory in _lstAccessories)
					objAccessory.Print(objWriter);
				objWriter.WriteEndElement();
			}
			if (_lstWeaponMods.Count > 0)
			{
				objWriter.WriteStartElement("mods");
				foreach (WeaponMod objMod in _lstWeaponMods)
					objMod.Print(objWriter);
				objWriter.WriteEndElement();
			}

			// <ranges>
			objWriter.WriteStartElement("ranges");
			objWriter.WriteElementString("short", RangeShort);
			objWriter.WriteElementString("medium", RangeMedium);
			objWriter.WriteElementString("long", RangeLong);
			objWriter.WriteElementString("extreme", RangeExtreme);
			// </ranges>
			objWriter.WriteEndElement();

			if (_lstUnderbarrel.Count > 0)
			{
				foreach (Weapon objUnderbarrel in _lstUnderbarrel)
				{
					objWriter.WriteStartElement("underbarrel");
					objUnderbarrel.Print(objWriter);
					objWriter.WriteEndElement();
				}
			}

			// Currently loaded Ammo.
			Guid guiAmmo = new Guid();
			if (_intActiveAmmoSlot == 1)
				guiAmmo = _guiAmmoLoaded;
			else if (_intActiveAmmoSlot == 2)
				guiAmmo = _guiAmmoLoaded2;
			else if (_intActiveAmmoSlot == 3)
				guiAmmo = _guiAmmoLoaded3;
			else if (_intActiveAmmoSlot == 4)
				guiAmmo = _guiAmmoLoaded4;

			objWriter.WriteElementString("currentammo", GetAmmoName(guiAmmo));
			objWriter.WriteElementString("ammoslot1", GetAmmoName(_guiAmmoLoaded));
			objWriter.WriteElementString("ammoslot2", GetAmmoName(_guiAmmoLoaded2));
			objWriter.WriteElementString("ammoslot3", GetAmmoName(_guiAmmoLoaded3));
			objWriter.WriteElementString("ammoslot4", GetAmmoName(_guiAmmoLoaded4));

			objWriter.WriteElementString("dicepool", DicePool);

			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);

			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Get the name of Ammo from the character or Vehicle.
		/// </summary>
		/// <param name="guiAmmo">InternalId of the Ammo to find.</param>
		private string GetAmmoName(Guid guiAmmo)
		{
			if (guiAmmo == Guid.Empty)
				return "";
			else
			{
				CommonFunctions objFunctions = new CommonFunctions(_objCharacter);
				Gear objAmmo = objFunctions.FindGear(guiAmmo.ToString(), _objCharacter.Gear);
				if (objAmmo == null)
				{
					Vehicle objVehicle = new Vehicle(_objCharacter);
					objAmmo = objFunctions.FindVehicleGear(guiAmmo.ToString(), _objCharacter.Vehicles, out objVehicle);
				}

				if (objAmmo != null)
					return objAmmo.DisplayNameShort;
				else
					return "";
			}
		}
		#endregion

		#region Properties
		/// <summary>
		/// Weapon Accessories.
		/// </summary>
		public List<WeaponAccessory> WeaponAccessories
		{
			get
			{
				return _lstAccessories;
			}
		}

		/// <summary>
		/// Weapon Modifications.
		/// </summary>
		public List<WeaponMod> WeaponMods
		{
			get
			{
				return _lstWeaponMods;
			}
		}

		/// <summary>
		/// Underbarrel Weapon.
		/// </summary>
		public List<Weapon> UnderbarrelWeapons
		{
			get
			{
				return _lstUnderbarrel;
			}
		}

		/// <summary>
		/// Whether or not this Weapon is an Underbarrel Weapon.
		/// </summary>
		public bool IsUnderbarrelWeapon
		{
			get
			{
				return _blnUnderbarrel;
			}
			set
			{
				_blnUnderbarrel = value;
			}
		}

		/// <summary>
		/// Internal identifier which will be used to identify this Weapon.
		/// </summary>
		public string InternalId
		{
			get
			{
				return _guiID.ToString();
			}
		}

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

				if (_strWeaponName != "")
				{
					strReturn += " (\"" + _strWeaponName + "\")";
				}

				return strReturn;
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
		/// A custom name for the Weapon assigned by the player.
		/// </summary>
		public string WeaponName
		{
			get
			{
				return _strWeaponName;
			}
			set
			{
				_strWeaponName = value;
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

				// So Categories are actually the name of object types, so pull them from the language file.
				if (strReturn == "Gear")
				{
					strReturn = LanguageManager.Instance.GetString("String_SelectPACKSKit_Gear");
				}
				if (strReturn == "Cyberware")
				{
					strReturn = LanguageManager.Instance.GetString("String_SelectPACKSKit_Cyberware");
				}
				if (strReturn == "Bioware")
				{
					strReturn = LanguageManager.Instance.GetString("String_SelectPACKSKit_Bioware");
				}

				return strReturn;
			}
		}

		/// <summary>
		/// Translated Ammo Category.
		/// </summary>
		public string DisplayAmmoCategory
		{
			get
			{
				string strReturn = AmmoCategory;
				// Get the translated name if applicable.
				if (GlobalOptions.Instance.Language != "en-us")
				{
					XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
					XmlNode objNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + _strCategory + "\"]");
					if (objNode != null)
					{
						if (objNode.Attributes["translate"] != null)
							strReturn = objNode.Attributes["translate"].InnerText;
					}
				}

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
		/// Type of Weapon (either Melee or Ranged).
		/// </summary>
		public string WeaponType
		{
			get
			{
				return _strType;
			}
			set
			{
				_strType = value;
			}
		}

		/// <summary>
		/// Reach.
		/// </summary>
		public int Reach
		{
			get
			{
				return _intReach;
			}
			set
			{
				_intReach = value;
			}
		}

		/// <summary>
		/// Damage.
		/// </summary>
		public string Damage
		{
			get
			{
				return _strDamage;
			}
			set
			{
				_strDamage = value;
			}
		}

		/// <summary>
		/// Armor Penetration.
		/// </summary>
		public string AP
		{
			get
			{
				return _strAP;
			}
			set
			{
				_strAP = value;
			}
		}

		/// <summary>
		/// Firing Mode.
		/// </summary>
		public string Mode
		{
			get
			{
				return _strMode;
			}
			set
			{
				_strMode = value;
			}
		}

		/// <summary>
		/// Recoil.
		/// </summary>
		public string RC
		{
			get
			{
				if (_strRC == "0")
					return "-";
				else
					return _strRC;
			}
			set
			{
				_strRC = value;
			}
		}

		/// <summary>
		/// Ammo.
		/// </summary>
		public string Ammo
		{
			get
			{
				return _strAmmo;
			}
			set
			{
				_strAmmo = value;
			}
		}

		/// <summary>
		/// Category of Ammo the Weapon uses.
		/// </summary>
		public string AmmoCategory
		{
			get
			{
				if (_strAmmoCategory != "")
					return _strAmmoCategory;
				else
				{
					if (_strCategory.StartsWith("Cyberware"))
						return _strCategory.Replace("Cyberware", string.Empty).Trim();
					else
						return _strCategory;
				}
			}
		}

		/// <summary>
		/// The number of rounds remaining in the Weapon.
		/// </summary>
		public int AmmoRemaining
		{
			get
			{
				switch (_intActiveAmmoSlot)
				{
					case 1:
						return _intAmmoRemaining;
					case 2:
						return _intAmmoRemaining2;
					case 3:
						return _intAmmoRemaining3;
					case 4:
						return _intAmmoRemaining4;
					default:
						return _intAmmoRemaining;
				}
			}
			set
			{
				switch (_intActiveAmmoSlot)
				{
					case 1:
						_intAmmoRemaining = value;
						break;
					case 2:
						_intAmmoRemaining2 = value;
						break;
					case 3:
						_intAmmoRemaining3 = value;
						break;
					case 4:
						_intAmmoRemaining4 = value;
						break;
					default:
						_intAmmoRemaining = value;
						break;
				}
			}
		}

		/// <summary>
		/// The type of Ammuniation loaded in the Weapon.
		/// </summary>
		public string AmmoLoaded
		{
			get
			{
				switch (_intActiveAmmoSlot)
				{
					case 1:
						return _guiAmmoLoaded.ToString();
					case 2:
						return _guiAmmoLoaded2.ToString();
					case 3:
						return _guiAmmoLoaded3.ToString();
					case 4:
						return _guiAmmoLoaded4.ToString();
					default:
						return _guiAmmoLoaded.ToString();
				}
			}
			set
			{
				switch (_intActiveAmmoSlot)
				{
					case 1:
						_guiAmmoLoaded = Guid.Parse(value);
						break;
					case 2:
						_guiAmmoLoaded2 = Guid.Parse(value);
						break;
					case 3:
						_guiAmmoLoaded3 = Guid.Parse(value);
						break;
					case 4:
						_guiAmmoLoaded4 = Guid.Parse(value);
						break;
					default:
						_guiAmmoLoaded = Guid.Parse(value);
						break;
				}
			}
		}

		/// <summary>
		/// Active Ammo slot number.
		/// </summary>
		public int ActiveAmmoSlot
		{
			get
			{
				return _intActiveAmmoSlot;
			}
			set
			{
				_intActiveAmmoSlot = value;
			}
		}

		/// <summary>
		/// Number of Ammo slots the Weapon has.
		/// </summary>
		public int AmmoSlots
		{
			get
			{
				int intReturn = 1;

				if (CalculatedAmmo().Contains("x"))
				{
					if (CalculatedAmmo().StartsWith("2x"))
						intReturn = 2;
					if (CalculatedAmmo().StartsWith("3x"))
						intReturn = 3;
					if (CalculatedAmmo().StartsWith("4x"))
						intReturn = 4;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Concealability.
		/// </summary>
		public int Concealability
		{
			get
			{
				return _intConceal;
			}
			set
			{
				_intConceal = value;
			}
		}

		/// <summary>
		/// Avail.
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
		/// Whether or not the Weapon is mounted on a Vehicle.
		/// </summary>
		public bool VehicleMounted
		{
			get
			{
				return _blnVehicleMounted;
			}
			set
			{
				_blnVehicleMounted = value;
			}
		}

		/// <summary>
		/// Whether or not the Underbarrel Weapon is part of the parent Weapon by default.
		/// </summary>
		public bool IncludedInWeapon
		{
			get
			{
				return _blnIncludedInWeapon;
			}
			set
			{
				_blnIncludedInWeapon = value;
			}
		}

		/// <summary>
		/// Whether or not the Underbarrel Weapon is installed.
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

		/// <summary>
		/// Active Skill that should be used with this Weapon instead of the default one.
		/// </summary>
		public string UseSkill
		{
			get
			{
				return _strUseSkill;
			}
			set
			{
				_strUseSkill = value;
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

		/// <summary>
		/// Whether or not the Weapon requires Ammo to be reloaded.
		/// </summary>
		public bool RequireAmmo
		{
			get
			{
				return _blnRequireAmmo;
			}
			set
			{
				_blnRequireAmmo = value;
			}
		}

		/// <summary>
		/// The Active Skill Specialization that this Weapon uses, in addition to any others it would normally use.
		/// </summary>
		public string Spec
		{
			get
			{
				return _strSpec;
			}
		}

		/// <summary>
		/// The second Active Skill Specialization that this Weapon uses, in addition to any others it would normally use.
		/// </summary>
		public string Spec2
		{
			get
			{
				return _strSpec2;
			}
		}
		#endregion

		#region Complex Properties
		/// <summary>
		/// Weapon's total Concealability including all Accessories and Modifications.
		/// </summary>
		public string CalculatedConcealability()
		{
			int intReturn = _intConceal;

			foreach (WeaponAccessory objAccessory in _lstAccessories)
			{
				if (objAccessory.Installed)
					intReturn += objAccessory.Concealability;
			}

			foreach (WeaponMod objMod in _lstWeaponMods)
			{
				if (objMod.Installed)
					intReturn += objMod.Concealability;
			}

			// Add +4 for each Underbarrel Weapon installed.
			if (_lstUnderbarrel.Count > 0)
			{
				foreach (Weapon objUnderbarrelWeapon in _lstUnderbarrel)
				{
					if (objUnderbarrelWeapon.Installed)
						intReturn += 4;
				}
			}

			// Factor in the character's Concealability modifiers.
			ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
			intReturn += objImprovementManager.ValueOf(Improvement.ImprovementType.Concealability);

			string strReturn = "";
			if (intReturn >= 0)
				strReturn = "+" + intReturn.ToString();
			else
				strReturn = intReturn.ToString();

			return strReturn;
		}

		/// <summary>
		/// Weapon's Damage including all Accessories, Modifications, Attributes, and Ammunition.
		/// </summary>
		public string CalculatedDamage(int intUseSTR = 0, bool blnForceEnglish = false)
		{
			string strReturn = "";

			// If the cost is determined by the Rating, evaluate the expression.
			XmlDocument objXmlDocument = new XmlDocument();
			XPathNavigator nav = objXmlDocument.CreateNavigator();

			string strDamage = "";
			string strDamageExpression = _strDamage;
			string strDamageType = "";
			string strDamageExtra = "";
			XPathExpression xprDamage;

			if (_objCharacter != null)
			{
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);

				if (_strCategory.StartsWith("Cyberware"))
				{
					int intSTR = _objCharacter.STR.TotalValue;
					// Look to see if this is attached to a Cyberlimb and use its STR instead.
					foreach (Cyberware objCyberware in _objCharacter.Cyberware)
					{
						if (objCyberware.LimbSlot != string.Empty)
						{
							if (objCyberware.WeaponID == InternalId)
								intSTR = objCyberware.TotalStrength;
							else
							{
								foreach (Cyberware objChild in objCyberware.Children)
								{
									if (objChild.WeaponID == InternalId)
									{
										intSTR = objCyberware.TotalStrength;
										break;
									}
								}
							}
						}
					}

					// A STR value has been passed, so use that instead.
					if (intUseSTR > 0)
						intSTR = intUseSTR;

					if (_strCategory == "Throwing Weapons" || _strUseSkill == "Throwing Weapons")
						intSTR += objImprovementManager.ValueOf(Improvement.ImprovementType.ThrowSTR);

					strDamage = strDamageExpression.Replace("STR", intSTR.ToString());
				}
				else
				{
					int intThrowDV = 0;
					if (_strCategory == "Throwing Weapons" || _strUseSkill == "Throwing Weapons")
						intThrowDV = objImprovementManager.ValueOf(Improvement.ImprovementType.ThrowSTR);

					// A STR value has been passed, so use that instead.
					if (intUseSTR > 0)
						strDamage = strDamageExpression.Replace("STR", (intUseSTR + intThrowDV).ToString());
					else
						strDamage = strDamageExpression.Replace("STR", (_objCharacter.STR.TotalValue + intThrowDV).ToString());
				}
			}
			else
			{
				// If the character is null, this is a vehicle.
				strDamage = strDamageExpression.Replace("STR", intUseSTR.ToString());
			}

			// Evaluate the min expression if there is one.
			if (strDamage.Contains("min") && !strDamage.Contains("mini") && !strDamage.Contains("mine"))
			{
				string strMin = "";
				int intStart = strDamage.IndexOf("min");
				int intEnd = strDamage.IndexOf(")", intStart);
				strMin = strDamage.Substring(intStart, intEnd - intStart + 1);

				string strExpression = strMin;
				strExpression = strExpression.Replace("min", string.Empty).Replace("(", string.Empty).Replace(")", string.Empty);

				string[] strValue = strExpression.Split(',');
				strExpression = Math.Min(Convert.ToInt32(strValue[0]), Convert.ToInt32(strValue[1])).ToString();

				strDamage = strDamage.Replace(strMin, strExpression);
			}

			// Place the Damage Type (P or S) into a string and remove it from the expression.
			if (strDamage.Contains("P or S"))
			{
				strDamageType = "P or S";
				strDamage = strDamage.Replace("P or S", string.Empty);
			}
			else
			{
				if (strDamage.Contains("P"))
				{
					strDamageType = "P";
					strDamage = strDamage.Replace("P", string.Empty);
				}
				if (strDamage.Contains("S"))
				{
					strDamageType = "S";
					strDamage = strDamage.Replace("S", string.Empty);
				}
			}
			// Place any extra text like (e) and (f) in a string and remove it from the expression.
			if (strDamage.Contains("(e)"))
			{
				strDamageExtra = "(e)";
				strDamage = strDamage.Replace("(e)", string.Empty);
			}
			if (strDamage.Contains("(f)"))
			{
				strDamageExtra = "(f)";
				strDamage = strDamage.Replace("(f)", string.Empty);
			}

			// Look for splash damage info.
			if (strDamage.Contains("/m)"))
			{
				string strSplash = strDamage.Substring(strDamage.IndexOf("("), strDamage.IndexOf(")") - strDamage.IndexOf("(") + 1);
				strDamageExtra += " " + strSplash;
				strDamage = strDamage.Replace(strSplash, string.Empty).Trim();
			}

			// Replace the division sign with "div" since we're using XPath.
			strDamage = strDamage.Replace("/", " div ");

			// Include WeaponCategoryDV Improvements.
			int intImprove = 0;
			if (_objCharacter != null)
			{
				foreach (Improvement objImprovement in _objCharacter.Improvements)
				{
					if (objImprovement.ImproveType == Improvement.ImprovementType.WeaponCategoryDV && objImprovement.Enabled && (objImprovement.ImprovedName == _strCategory || "Cyberware " + objImprovement.ImprovedName == _strCategory))
						intImprove += objImprovement.Value;
					if (_strUseSkill != string.Empty)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.WeaponCategoryDV && objImprovement.Enabled && (objImprovement.ImprovedName == _strUseSkill || "Cyberware " + objImprovement.ImprovedName == _strCategory))
							intImprove += objImprovement.Value;
					}
				}
			}

			// If this is the Unarmed Attack Weapon and the character has the UnarmedDVPhysical Improvement, change the type to Physical.
			// This should also add any UnarmedDV bonus which only applies to Unarmed Combat, not Unarmed Weapons.
			if (_strName == "Unarmed Attack")
			{
				foreach (Improvement objImprovement in _objCharacter.Improvements)
				{
					if (objImprovement.ImproveType == Improvement.ImprovementType.UnarmedDVPhysical && objImprovement.Enabled)
						strDamageType = "P";
					if (objImprovement.ImproveType == Improvement.ImprovementType.UnarmedDV && objImprovement.Enabled)
						intImprove += objImprovement.Value;
				}
			}

			// Add in the DV bonus from any Weapon Mods.
			foreach (WeaponMod objMod in _lstWeaponMods)
			{
				if (objMod.Installed)
					intImprove += objMod.DVBonus;
			}

			strDamage += " + " + intImprove.ToString();

			try
			{
				CommonFunctions objFunctions = new CommonFunctions(_objCharacter);
				CharacterOptions objOptions = _objCharacter.Options;
				int intBonus = 0;
				if (objOptions.MoreLethalGameplay)
					intBonus = 2;
				bool blnDamageReplaced = false;

				// Check if the Weapon has Ammunition loaded and look for any Damage bonus/replacement.
				if (AmmoLoaded != "")
				{
					// Look for Ammo on the character.
					Gear objGear = objFunctions.FindGear(AmmoLoaded, _objCharacter.Gear);
					if (objGear == null)
					{
						Vehicle objFoundVehicle;
						objGear = objFunctions.FindVehicleGear(AmmoLoaded, _objCharacter.Vehicles, out objFoundVehicle);
					}
					if (objGear != null)
					{
						if (objGear.WeaponBonus != null)
						{
							// Change the Weapon's Damage Type. (flechette rounds cannot affect weapons that have flechette included in their damage)
							if (!(objGear.WeaponBonus.InnerXml.Contains("(f)") && _strDamage.Contains("(f)")))
							{
								if (objGear.WeaponBonus["damagetype"] != null)
								{
									strDamageType = "";
									strDamageExtra = objGear.WeaponBonus["damagetype"].InnerText;
								}
								// Adjust the Weapon's Damage.
								if (objGear.WeaponBonus["damage"] != null)
									strDamage += " + " + objGear.WeaponBonus["damage"].InnerText;
								if (objGear.WeaponBonus["damagereplace"] != null)
								{
									blnDamageReplaced = true;
									strDamage = objGear.WeaponBonus["damagereplace"].InnerText;
								}
							}
						}

						// Do the same for any plugins.
						foreach (Gear objChild in objGear.Children)
						{
							if (objChild.WeaponBonus != null)
							{
								// Change the Weapon's Damage Type. (flechette rounds cannot affect weapons that have flechette included in their damage)
								if (!(objChild.WeaponBonus.InnerXml.Contains("(f)") && _strDamage.Contains("(f)")))
								{
									if (objChild.WeaponBonus["damagetype"] != null)
									{
										strDamageType = "";
										strDamageExtra = objChild.WeaponBonus["damagetype"].InnerText;
									}
									// Adjust the Weapon's Damage.
									if (objChild.WeaponBonus["damage"] != null)
										strDamage += " + " + objChild.WeaponBonus["damage"].InnerText;
									if (objChild.WeaponBonus["damagereplace"] != null)
									{
										blnDamageReplaced = true;
										strDamage = objChild.WeaponBonus["damagereplace"].InnerText;
									}
								}
								break;
							}
						}
					}
				}

				if (!blnDamageReplaced)
				{
					xprDamage = nav.Compile(strDamage);
					double dblDamage = 0;
					dblDamage = Math.Ceiling(Convert.ToDouble(nav.Evaluate(xprDamage), GlobalOptions.Instance.CultureInfo) + intBonus);
					if (_strName == "Unarmed Attack (Smashing Blow)")
						dblDamage *= 2.0;
					strReturn = dblDamage.ToString() + strDamageType + strDamageExtra;
				}
				else
				{
					// Place the Damage Type (P or S) into a string and remove it from the expression.
					if (strDamage.Contains("P or S"))
					{
						strDamageType = "P or S";
						strDamage = strDamage.Replace("P or S", string.Empty);
					}
					else
					{
						if (strDamage.Contains("P"))
						{
							strDamageType = "P";
							strDamage = strDamage.Replace("P", string.Empty);
						}
						if (strDamage.Contains("S"))
						{
							strDamageType = "S";
							strDamage = strDamage.Replace("S", string.Empty);
						}
					}
					// Place any extra text like (e) and (f) in a string and remove it from the expression.
					if (strDamage.Contains("(e)"))
					{
						strDamageExtra = "(e)";
						strDamage = strDamage.Replace("(e)", string.Empty);
					}
					if (strDamage.Contains("(f)"))
					{
						strDamageExtra = "(f)";
						strDamage = strDamage.Replace("(f)", string.Empty);
					}
					// Replace the division sign with "div" since we're using XPath.
					strDamage = strDamage.Replace("/", " div ");

					xprDamage = nav.Compile(strDamage);
					double dblDamage = 0;
					dblDamage = Math.Ceiling(Convert.ToDouble(nav.Evaluate(xprDamage), GlobalOptions.Instance.CultureInfo) + intBonus);
					if (_strName == "Unarmed Attack (Smashing Blow)")
						dblDamage *= 2.0;
					strReturn = dblDamage.ToString() + strDamageType + strDamageExtra;
				}
			}
			catch
			{
				strReturn = _strDamage;
			}

			// If the string couldn't be parsed (resulting in NaN which will happen if it is a special string like "Grenade", "Chemical", etc.), return the Weapon's Damage string.
			if (strReturn.StartsWith("NaN"))
				strReturn = _strDamage;

			// Translate the Damage Code.
			if (!blnForceEnglish)
			{
				strReturn = strReturn.Replace("S", LanguageManager.Instance.GetString("String_DamageStun"));
				strReturn = strReturn.Replace("P", LanguageManager.Instance.GetString("String_DamagePhysical"));

				strReturn = strReturn.Replace("Chemical", LanguageManager.Instance.GetString("String_DamageChemical"));
				strReturn = strReturn.Replace("Special", LanguageManager.Instance.GetString("String_DamageSpecial"));
				strReturn = strReturn.Replace("(e)", LanguageManager.Instance.GetString("String_DamageElectric"));
				strReturn = strReturn.Replace("(f)", LanguageManager.Instance.GetString("String_DamageFlechette"));
				strReturn = strReturn.Replace("P or S", LanguageManager.Instance.GetString("String_DamagePOrS"));
				strReturn = strReturn.Replace("Grenade", LanguageManager.Instance.GetString("String_DamageGrenade"));
				strReturn = strReturn.Replace("Missile", LanguageManager.Instance.GetString("String_DamageMissile"));
				strReturn = strReturn.Replace("Mortar", LanguageManager.Instance.GetString("String_DamageMortar"));
				strReturn = strReturn.Replace("Rocket", LanguageManager.Instance.GetString("String_DamageRocket"));
				strReturn = strReturn.Replace("Radius", LanguageManager.Instance.GetString("String_DamageRadius"));
				strReturn = strReturn.Replace("As Drug/Toxin", LanguageManager.Instance.GetString("String_DamageAsDrugToxin"));
				strReturn = strReturn.Replace("as round", LanguageManager.Instance.GetString("String_DamageAsRound"));
				strReturn = strReturn.Replace("/m", "/" + LanguageManager.Instance.GetString("String_DamageMeter"));
			}

			return strReturn;
		}

		/// <summary>
		/// Calculated Ammo capacity.
		/// </summary>
		public string CalculatedAmmo(bool blnForceEnglish = false)
		{
			string[] strSplit = new string[] { " " };
			string[] strAmmos = _strAmmo.Split(strSplit, StringSplitOptions.None);
			string strReturn = "";
			bool blnAdditionalClip = false;
			int intAmmoBonus = 0;

			foreach (WeaponMod objMod in _lstWeaponMods)
			{
				// Replace the Ammo value.
				if (objMod.AmmoReplace != "")
				{
					strAmmos = new string[] { objMod.AmmoReplace };
					break;
				}

				// If the Mod is an Additional Clip that is not included with the base Weapon, turn on the Additional Clip flag.
				if ((objMod.Name == "Additional Clip" || objMod.Name == "Additional Clip, Pistol") && !objMod.IncludedInWeapon)
					blnAdditionalClip = true;

				intAmmoBonus += objMod.AmmoBonus;
			}

			foreach (string strAmmo in strAmmos)
			{
				string strThisAmmo = strAmmo;
				if (strThisAmmo.Contains("("))
				{
					int intAmmo = 0;
					string strAmmoString = "";
					string strPrepend = "";
					try
					{
						strThisAmmo = strThisAmmo.Substring(0, strThisAmmo.IndexOf("("));
						if (strThisAmmo.Contains("x"))
						{
							strPrepend = strThisAmmo.Substring(0, strThisAmmo.IndexOf("x") + 1);
							strThisAmmo = strThisAmmo.Substring(strThisAmmo.IndexOf("x") + 1, strThisAmmo.Length - (strThisAmmo.IndexOf("x") + 1));
						}

						// If this is an Underbarrel Weapons that has been added, cut the Ammo capacity in half.
						if (IsUnderbarrelWeapon && !IncludedInWeapon)
							intAmmo = Convert.ToInt32(strThisAmmo) / 2;
						else
							intAmmo = Convert.ToInt32(strThisAmmo);

						if (intAmmoBonus != 0)
						{
							double dblBonus = Convert.ToDouble(intAmmoBonus, GlobalOptions.Instance.CultureInfo) / 100.0;
							intAmmo += Convert.ToInt32(Math.Ceiling(Convert.ToDouble(intAmmo, GlobalOptions.Instance.CultureInfo) * dblBonus));
						}

						strAmmoString = intAmmo.ToString();
						if (strPrepend != "")
							strAmmoString = strPrepend + strAmmoString;
					}
					catch
					{
					}
					strThisAmmo = strAmmoString + strAmmo.Substring(strAmmo.IndexOf("("), strAmmo.Length - strAmmo.IndexOf("("));
				}
				strReturn += strThisAmmo + " ";
			}

			// If the Additional Clip flag is on, increment the clip multiplier.
			if (blnAdditionalClip)
			{
				if (strReturn.Contains("2x"))
					strReturn = strReturn.Replace("2x", "3x");
				else
					strReturn = "2x" + strReturn;
			}
			strReturn = strReturn.Trim();

			if (!blnForceEnglish)
			{
				// Translate the Ammo string.
				strReturn = strReturn.Replace(" or ", " " + LanguageManager.Instance.GetString("String_Or") + " ");
				strReturn = strReturn.Replace(" belt", LanguageManager.Instance.GetString("String_AmmoBelt"));
				strReturn = strReturn.Replace(" Energy", LanguageManager.Instance.GetString("String_AmmoEnergy"));
				strReturn = strReturn.Replace(" external source", LanguageManager.Instance.GetString("String_AmmoExternalSource"));
				strReturn = strReturn.Replace(" Special", LanguageManager.Instance.GetString("String_AmmoSpecial"));

				strReturn = strReturn.Replace("(b)", "(" + LanguageManager.Instance.GetString("String_AmmoBreakAction") + ")");
				strReturn = strReturn.Replace("(belt)", "(" + LanguageManager.Instance.GetString("String_AmmoBelt") + ")");
				strReturn = strReturn.Replace("(box)", "(" + LanguageManager.Instance.GetString("String_AmmoBox") + ")");
				strReturn = strReturn.Replace("(c)", "(" + LanguageManager.Instance.GetString("String_AmmoClip") + ")");
				strReturn = strReturn.Replace("(cy)", "(" + LanguageManager.Instance.GetString("String_AmmoCylinder") + ")");
				strReturn = strReturn.Replace("(d)", "(" + LanguageManager.Instance.GetString("String_AmmoDrum") + ")");
				strReturn = strReturn.Replace("(m)", "(" + LanguageManager.Instance.GetString("String_AmmoMagazine") + ")");
				strReturn = strReturn.Replace("(ml)", "(" + LanguageManager.Instance.GetString("String_AmmoMuzzleLoad") + ")");
			}
				
			return strReturn;
		}

		/// <summary>
		/// The Weapon's Firing Mode including Modifications.
		/// </summary>
		public string CalculatedMode
		{
			get
			{
				List<string> lstModes = new List<string>();
				string[] strModes = _strMode.Split('/');
				string strReturn = "";

				// Move the contents of the array to a list so it's easier to work with.
				foreach (string strMode in strModes)
					lstModes.Add(strMode);

				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.AddMode != "")
						lstModes.Add(objMod.AddMode);
				}

				if (lstModes.Contains("SS"))
					strReturn += LanguageManager.Instance.GetString("String_ModeSingleShot") + "/";
				if (lstModes.Contains("SA"))
					strReturn += LanguageManager.Instance.GetString("String_ModeSemiAutomatic") + "/";
				if (lstModes.Contains("BF"))
					strReturn += LanguageManager.Instance.GetString("String_ModeBurstFire") + "/";
				if (lstModes.Contains("FA"))
					strReturn += LanguageManager.Instance.GetString("String_ModeFullAutomatic") + "/";
				if (lstModes.Contains("Special"))
					strReturn += LanguageManager.Instance.GetString("String_ModeSpecial") + "/";

				// Remove the trailing "/".
				if (strReturn != "")
					strReturn = strReturn.Substring(0, strReturn.Length - 1);

				return strReturn;
			}
		}

		/// <summary>
		/// Determine if the Weapon is capable of firing in a particular mode.
		/// </summary>
		/// <param name="strFindMode">Firing mode to find.</param>
		public bool AllowMode(string strFindMode)
		{
			string[] strModes = CalculatedMode.Split('/');
			foreach (string strMode in strModes)
			{
				if (strMode == strFindMode)
					return true;
			}
			return false;
		}

		/// <summary>
		/// Weapon Cost to use when working with Total Cost price modifiers for Weapon Mods.
		/// </summary>
		public int MultipliableCost
		{
			get
			{
				int intWeaponCost = _intCost;
				int intReturn = intWeaponCost;

				// Run through the list of Weapon Mods.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (!objMod.IncludedInWeapon)
					{
						if (!objMod.Cost.StartsWith("Total Cost"))
							intReturn += objMod.TotalCost;
					}
				}

				return intReturn;
			}
		}

		/// <summary>
		/// The Weapon's total cost including Accessories and Modifications.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intWeaponCost = _intCost;
				int intReturn = intWeaponCost;
				int intCostMultiplier = 1;
				int intWeaponCostMultiplier = 1;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Run through the list of Weapon Mods.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (!objMod.IncludedInWeapon)
					{
						intReturn += objMod.TotalCost;
					}
				}

				// Run through the Weapon Mods and see if anything changes the cost multiplier (Vintage mod).
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.AccessoryCostMultiplier > 1 || objMod.ModCostMultiplier > 1)
						intCostMultiplier = objMod.AccessoryCostMultiplier;
				}

				// Multiply the Total Cost of the Weapon (base cost + Mods only, not Accessories)
				intReturn *= intWeaponCostMultiplier;

				// Run through the Accessories and add in their cost. If the cost is "Weapon Cost", the Weapon's base cost is added in again.
				foreach (WeaponAccessory objAccessory in _lstAccessories)
				{
					if (!objAccessory.IncludedInWeapon)
						intReturn += objAccessory.TotalCost;
				}

				// If this is a Cyberware or Gear Weapon, remove the Weapon Cost from this since it has already been paid for through the parent item (but is needed to calculate Mod price).
				if (_strCategory.StartsWith("Cyberware") || _strCategory == "Gear")
					intReturn -= intWeaponCost;

				// Include the cost of any Underbarrel Weapon.
				if (_lstUnderbarrel.Count > 0)
				{
					foreach (Weapon objUnderbarrel in _lstUnderbarrel)
						intReturn += objUnderbarrel.TotalCost;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// The cost of just the Weapon itself.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intWeaponCost = _intCost;
				int intReturn = intWeaponCost;
				int intCostMultiplier = 1;
				int intWeaponCostMultiplier = 1;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Run through the Weapon Mods and see if anything changes the cost multiplier (Vintage mod).
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.AccessoryCostMultiplier > 1 || objMod.ModCostMultiplier > 1)
						intCostMultiplier = objMod.AccessoryCostMultiplier;
				}

				// Multiply the Total Cost of the Weapon (base cost + Mods only, not Accessories)
				intReturn *= intWeaponCostMultiplier;

				// If this is a Cyberware or Gear Weapon, remove the Weapon Cost from this since it has already been paid for through the parent item (but is needed to calculate Mod price).
				if (_strCategory.StartsWith("Cyberware") || _strCategory == "Gear")
					intReturn -= intWeaponCost;

				return intReturn;
			}
		}

		/// <summary>
		/// The Weapon's total AP including Ammunition.
		/// </summary>
		public string TotalAP
		{
			get
			{
				string strAP = _strAP;
				if (strAP == "-")
					strAP = "0";
				int intAP = 0;

				try
				{
					intAP = Convert.ToInt32(strAP);
				}
				catch
				{
					// If AP is not numeric (for example "-half"), do do anything and just return the weapon's AP.
					return _strAP.Replace("-half", LanguageManager.Instance.GetString("String_APHalf"));
				}

				bool blnAPReplaced = false;
				CommonFunctions objFunctions = new CommonFunctions(_objCharacter);

				// Check if the Weapon has Ammunition loaded and look for any Damage bonus/replacement.
				if (AmmoLoaded != "")
				{
					// Look for Ammo on the character.
					Gear objGear = objFunctions.FindGear(AmmoLoaded, _objCharacter.Gear);
					if (objGear == null)
					{
						Vehicle objFoundVehicle;
						objGear = objFunctions.FindVehicleGear(AmmoLoaded, _objCharacter.Vehicles, out objFoundVehicle);
					}
					if (objGear != null)
					{
						if (objGear.WeaponBonus != null)
						{
							// Change the Weapon's Damage Type. (flechette rounds cannot affect weapons that have flechette included in their damage)
							if (!(objGear.WeaponBonus.InnerXml.Contains("(f)") && _strDamage.Contains("(f)")))
							{
								// Armor-Piercing Flechettes (and any other that might come along that does not explicitly add +5 AP) should instead reduce
								// the AP for Flechette-only Weapons which have the standard Flechette +5 AP built into their stats.
								if (_strDamage.Contains("(f)") && objGear.Name.Contains("Flechette"))
								{
									intAP -= 5;
								}
								else
								{
									// Change the Weapon's Damage Type.
									if (objGear.WeaponBonus["apreplace"] != null)
									{
										blnAPReplaced = true;
										strAP = objGear.WeaponBonus["apreplace"].InnerText;
									}
									// Adjust the Weapon's Damage.
									if (objGear.WeaponBonus["ap"] != null)
										intAP += Convert.ToInt32(objGear.WeaponBonus["ap"].InnerText);
								}
							}
						}
					}

					if (_objCharacter != null)
					{
						// Add any UnarmedAP bonus for the Unarmed Attack item.
						if (_strName == "Unarmed Attack")
						{
							foreach (Improvement objImprovement in _objCharacter.Improvements)
							{
								if (objImprovement.ImproveType == Improvement.ImprovementType.UnarmedAP && objImprovement.Enabled)
									intAP += objImprovement.Value;
							}
						}
					}
					// If this is an Unarmed Cyberware Weapon (belongs to the Cyberware category), add the Unarmed AP bonus an Adept may have.
					if (_strCategory == "Cyberware")
					{
						ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
						intAP += objImprovementManager.ValueOf(Improvement.ImprovementType.UnarmedAP);
					}
				}

				// Add any AP modifications from Weapon Mods.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.Installed)
						intAP += objMod.APBonus;
				}

				if (!blnAPReplaced)
				{
					if (intAP == 0)
						return "-";
					else if (intAP > 0)
						return "+" + intAP.ToString();
					else
						return intAP.ToString();
				}
				else
					return strAP.Replace("-half", LanguageManager.Instance.GetString("String_APHalf"));
			}
		}

		/// <summary>
		/// The Weapon's total RC including Accessories and Modifications.
		/// </summary>
		public string TotalRC
		{
			get
			{
				string strRCBase = "0";
				string strRCFull = "0";
				string strRC = "";
				int intRCBase = 0;
				int intRCFull = 0;
				int intRCModifier = 0;

				int intRCGroup1 = 0;
				int intRCGroup2 = 0;
				int intRCGroup3 = 0;
				int intRCGroup4 = 0;
				int intRCGroup5 = 0;
				bool blnHasForegrip = false;
				bool blnHasSling = false;

				if (_strRC.Contains("("))
				{
					if (_strRC.Substring(0, 1) == "(")
					{
						// The string contains only RC from pieces that can be removed - "(x)" only.
						strRCFull = _strRC;
					}
					else
					{
						// The string contains a mix of both fixed and removable RC. "x(y)".
						int intPos = _strRC.IndexOf("(");
						strRCBase = _strRC.Substring(0, intPos);
						strRCFull = _strRC.Substring(intPos, _strRC.Length - intPos);
					}
				}
				else
				{
					// The string contains only RC from fixed pieces - "x" only.
					strRCBase = _strRC;
					strRCFull = _strRC;
				}

				intRCBase = Convert.ToInt32(strRCBase);
				intRCFull = Convert.ToInt32(strRCFull.Replace("(", string.Empty).Replace(")", string.Empty));

				if (intRCBase < 0)
				{
					intRCModifier = intRCBase;
					intRCBase = 0;
				}

				CommonFunctions objFunctions = new CommonFunctions(_objCharacter);

				// Check if the Weapon has Ammunition loaded and look for any Recoil bonus.
				if (AmmoLoaded != "")
				{
					Gear objGear = objFunctions.FindGear(AmmoLoaded, _objCharacter.Gear);
					if (objGear == null)
					{
						Vehicle objFoundVehicle;
						objGear = objFunctions.FindVehicleGear(AmmoLoaded, _objCharacter.Vehicles, out objFoundVehicle);
					}

					if (objGear != null)
					{
						if (objGear.WeaponBonus != null)
						{
							// Change the Weapon's Damage Type.
							if (objGear.WeaponBonus["rc"] != null)
							{
								intRCBase += Convert.ToInt32(objGear.WeaponBonus["rc"].InnerText);
								intRCFull += Convert.ToInt32(objGear.WeaponBonus["rc"].InnerText);
							}
						}
					}
				}

				// Now that we know the Weapon's RC values, run through all of the Accessories and add theirs to the mix.
				// Only add in the values for items that do not come with the weapon.
				foreach (WeaponAccessory objAccessory in _lstAccessories)
				{
					if (objAccessory.RC != "" && objAccessory.Installed)
					{
						if (_objCharacter.Options.RestrictRecoil && objAccessory.RCGroup != 0)
						{
							int intItemRC = 0;
							if (objAccessory.RC.Contains("("))
							{
								intItemRC = Convert.ToInt32(objAccessory.RC.Replace("(", string.Empty).Replace(")", string.Empty));
							}
							else
							{
								intItemRC = Convert.ToInt32(objAccessory.RC);
								intItemRC = Convert.ToInt32(objAccessory.RC);
							}

							switch (objAccessory.RCGroup)
							{
								case 1:
									if (intRCGroup1 < intItemRC)
										intRCGroup1 = intItemRC;
									if (objAccessory.Name == "Foregrip")
										blnHasForegrip = true;
									if (objAccessory.Name == "Sling")
										blnHasSling = true;
									break;
								case 2:
									if (intRCGroup2 < intItemRC)
										intRCGroup2 = intItemRC;
									break;
								case 3:
									if (intRCGroup3 < intItemRC)
										intRCGroup3 = intItemRC;
									break;
								case 4:
									if (intRCGroup4 < intItemRC)
										intRCGroup4 = intItemRC;
									break;
								case 5:
									if (intRCGroup5 < intItemRC)
										intRCGroup5 = intItemRC;
									break;
							}
						}
						else
						{
							if (objAccessory.RC.Contains("("))
							{
								intRCFull += Convert.ToInt32(objAccessory.RC.Replace("(", string.Empty).Replace(")", string.Empty));
							}
							else
							{
								intRCBase += Convert.ToInt32(objAccessory.RC);
								intRCFull += Convert.ToInt32(objAccessory.RC);
							}
						}
					}
				}

				// Only add in the values for items that do not come with the weapon.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.RC != "" && objMod.Installed)
					{
						if (_objCharacter.Options.RestrictRecoil && objMod.RCGroup != 0)
						{
							int intItemRC = 0;
							if (objMod.RC.Contains("("))
							{
								intItemRC = Convert.ToInt32(objMod.RC.Replace("(", string.Empty).Replace(")", string.Empty));
							}
							else
							{
								intItemRC = Convert.ToInt32(objMod.RC);
								intItemRC = Convert.ToInt32(objMod.RC);
							}

							switch (objMod.RCGroup)
							{
								case 1:
									if (intRCGroup1 < intItemRC)
										intRCGroup1 = intItemRC;
									if (objMod.Name == "Foregrip")
										blnHasForegrip = true;
									if (objMod.Name == "Sling")
										blnHasSling = true;
									break;
								case 2:
									if (intRCGroup2 < intItemRC)
										intRCGroup2 = intItemRC;
									break;
								case 3:
									if (intRCGroup3 < intItemRC)
										intRCGroup3 = intItemRC;
									break;
								case 4:
									if (intRCGroup4 < intItemRC)
										intRCGroup4 = intItemRC;
									break;
								case 5:
									if (intRCGroup5 < intItemRC)
										intRCGroup5 = intItemRC;
									break;
							}
						}
						else
						{
							if (objMod.RC.Contains("("))
							{
								intRCFull += Convert.ToInt32(objMod.RC.Replace("(", string.Empty).Replace(")", string.Empty));
							}
							else
							{
								intRCBase += Convert.ToInt32(objMod.RC);
								intRCFull += Convert.ToInt32(objMod.RC);
							}
						}
					}
				}

				// If both a Sling and Foregrip are present, see if their combined value is higher than Group 1's current value.
				if (blnHasForegrip && blnHasSling && intRCGroup1 < 2)
					intRCGroup1 = 2;

				// Add in the Recoil Group bonuses.
				intRCBase += intRCGroup1 + intRCGroup2 + intRCGroup3 + intRCGroup4 + intRCGroup5;
				intRCFull += intRCGroup1 + intRCGroup2 + intRCGroup3 + intRCGroup4 + intRCGroup5;

				// If the optional rule for a character's Strength affecting Recoil, factor that in.
				if (_objCharacter.Options.StrengthAffectsRecoil && _objCharacter.STR.TotalValue >= 6 && !_blnVehicleMounted)
				{
					if (_objCharacter.STR.TotalValue >= 18)
					{
						intRCBase += 4;
						intRCFull += 4;
					}
					else if (_objCharacter.STR.TotalValue >= 14 && _objCharacter.STR.TotalValue <= 17)
					{
						intRCBase += 3;
						intRCFull += 3;
					}
					else if (_objCharacter.STR.TotalValue >= 10 && _objCharacter.STR.TotalValue <= 13)
					{
						intRCBase += 2;
						intRCFull += 2;
					}
					else if (_objCharacter.STR.TotalValue >= 6 && _objCharacter.STR.TotalValue <= 9)
					{
						intRCBase += 1;
						intRCFull += 1;
					}
				}

				// If the full RC is not higher than the base, only the base value is shown.
				//if (intRCFull + intRCModifier <= intRCBase)
				//	strRC = intRCBase.ToString();
				//else
				strRC = intRCFull.ToString();

				return strRC;
			}
		}

		/// <summary>
		/// The full Reach of the Weapons including the Character's Reach.
		/// </summary>
		public int TotalReach
		{
			get
			{
				int intReach = _intReach;

				if (_strType == "Melee")
				{
					// Run through the Character's Improvements and add any Reach Improvements.
					foreach (Improvement objImprovement in _objCharacter.Improvements)
					{
						if (objImprovement.ImproveType == Improvement.ImprovementType.Reach && objImprovement.Enabled)
							intReach += Convert.ToInt32(objImprovement.Value);
					}
				}

				return intReach;
			}
		}

		/// <summary>
		/// The number of Weapon Mod slots remaining.
		/// </summary>
		public int SlotsRemaining
		{
			get
			{
				int intSlots = 6;

				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					// Only Mods that are installed and do not come included in the Weapon should consume slots.
					if (objMod.Installed)
					{
						if (!objMod.IncludedInWeapon)
							intSlots -= objMod.Slots;
					}
				}

				// Each installed Underbarrel Weapon consumes 3 slots.
				if (_lstUnderbarrel.Count > 0)
				{
					foreach (Weapon objUnderbarrelWeapon in _lstUnderbarrel)
					{
						if (objUnderbarrelWeapon.Installed && objUnderbarrelWeapon.Cost != 0)
							intSlots -= 3;
					}
				}

				return intSlots;
			}
		}

		/// <summary>
		/// Permanently alters the Weapon's Range category.
		/// </summary>
		/// <param name="strRange">name of the new Range category to use.</param>
		public void SetRange(string strRange)
		{
			_strRange = strRange;
		}

		/// <summary>
		/// Evalulate and return the requested Range for the Weapon.
		/// </summary>
		/// <param name="strFindRange">Range node to use.</param>
		private int Range(string strFindRange)
		{
			XmlDocument objXmlDocument = XmlManager.Instance.Load("ranges.xml");

			string strRangeCategory = _strCategory;
			if (_strRange != "")
				strRangeCategory = _strRange;

			string strRange = "";
			try
			{
				strRange = objXmlDocument.SelectSingleNode("/chummer/ranges/range[category = \"" + strRangeCategory + "\"]")[strFindRange].InnerText;
			}
			catch
			{
				return -1;
			}

			XPathNavigator nav = objXmlDocument.CreateNavigator();

			int intSTR = _objCharacter.STR.TotalValue;
			int intBOD = _objCharacter.BOD.TotalValue;

			// If this is a Throwing Weapon, include the ThrowRange bonuses in the character's STR.
			if (_strCategory == "Throwing Weapons" || _strUseSkill == "Throwing Weapons")
			{
				ImprovementManager objImprovementManager = new ImprovementManager(_objCharacter);
				intSTR += objImprovementManager.ValueOf(Improvement.ImprovementType.ThrowRange);
			}

			strRange = strRange.Replace("STR", intSTR.ToString());
			strRange = strRange.Replace("BOD", intBOD.ToString());

			XPathExpression xprRange = nav.Compile(strRange);

			double dblReturn = Convert.ToDouble(nav.Evaluate(xprRange).ToString(), GlobalOptions.Instance.CultureInfo) * _dblRangeMultiplier;
			int intReturn = Convert.ToInt32(Math.Floor(dblReturn));

			return intReturn;
		}

		/// <summary>
		/// Weapon's total Range bonus from Modifications.
		/// </summary>
		public double RangeBonus
		{
			get
			{
				int intRangeBonus = 100;

				// Weapon Mods.
				foreach (WeaponMod objMod in _lstWeaponMods)
					intRangeBonus += objMod.RangeBonus;

				// Check if the Weapon has Ammunition loaded and look for any Range bonus.
				if (AmmoLoaded != "")
				{
					CommonFunctions objFunctions = new CommonFunctions(_objCharacter);

					Gear objGear = objFunctions.FindGear(AmmoLoaded, _objCharacter.Gear);
					if (objGear == null)
					{
						Vehicle objFoundVehicle;
						objGear = objFunctions.FindVehicleGear(AmmoLoaded, _objCharacter.Vehicles, out objFoundVehicle);
					}

					if (objGear != null)
					{
						if (objGear.WeaponBonus != null)
						{
							intRangeBonus += objGear.WeaponBonusRange;
						}
					}
				}

				double dblRangeBonus = Convert.ToDouble(intRangeBonus, GlobalOptions.Instance.CultureInfo);
				dblRangeBonus /= 100;

				return dblRangeBonus;
			}
		}

		/// <summary>
		/// Weapon's Short Range.
		/// </summary>
		public string RangeShort
		{
			get
			{
				int intMin = Range("min");
				int intMax = Range("short");
				double dblRangeBonus = RangeBonus;

				double dblMin = Convert.ToDouble(intMin, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				double dblMax = Convert.ToDouble(intMax, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				intMin = Convert.ToInt32(Math.Ceiling(dblMin));
				intMax = Convert.ToInt32(Math.Ceiling(dblMax));

				if (intMin == -1 && intMax == -1)
					return "";
				else
					return intMin.ToString() + "-" + intMax.ToString();
			}
		}

		/// <summary>
		/// Weapon's Medium Range.
		/// </summary>
		public string RangeMedium
		{
			get
			{
				int intMin = Range("short");
				int intMax = Range("medium");
				double dblRangeBonus = RangeBonus;

				double dblMin = Convert.ToDouble(intMin, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				double dblMax = Convert.ToDouble(intMax, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				intMin = Convert.ToInt32(Math.Ceiling(dblMin));
				intMax = Convert.ToInt32(Math.Ceiling(dblMax));

				if (intMin == -1 && intMax == -1)
					return "";
				else
					return (intMin + 1).ToString() + "-" + intMax.ToString();
			}
		}

		/// <summary>
		/// Weapon's Long Range.
		/// </summary>
		public string RangeLong
		{
			get
			{
				int intMin = Range("medium");
				int intMax = Range("long");
				double dblRangeBonus = RangeBonus;

				double dblMin = Convert.ToDouble(intMin, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				double dblMax = Convert.ToDouble(intMax, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				intMin = Convert.ToInt32(Math.Ceiling(dblMin));
				intMax = Convert.ToInt32(Math.Ceiling(dblMax));

				if (intMin == -1 && intMax == -1)
					return "";
				else
					return (intMin + 1).ToString() + "-" + intMax.ToString();
			}
		}

		/// <summary>
		/// Weapon's Extreme Range.
		/// </summary>
		public string RangeExtreme
		{
			get
			{
				int intMin = Range("long");
				int intMax = Range("extreme");
				double dblRangeBonus = RangeBonus;

				double dblMin = Convert.ToDouble(intMin, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				double dblMax = Convert.ToDouble(intMax, GlobalOptions.Instance.CultureInfo) * dblRangeBonus;
				intMin = Convert.ToInt32(Math.Ceiling(dblMin));
				intMax = Convert.ToInt32(Math.Ceiling(dblMax));

				if (intMin == -1 && intMax == -1)
					return "";
				else
					return (intMin + 1).ToString() + "-" + intMax.ToString();
			}
		}

		/// <summary>
		/// Number of rounds consumed by Full Burst.
		/// </summary>
		public int FullBurst
		{
			get
			{
				int intReturn = _intFullBurst;

				// Check to see if any of the Mods replace this value.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.FullBurst > intReturn)
						intReturn = objMod.FullBurst;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Number of rounds consumed by Suppressive Fire.
		/// </summary>
		public int Suppressive
		{
			get
			{
				int intReturn = _intSuppressive;
				
				// Check to see if any of the Mods replace this value.
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.Suppressive > intReturn)
						intReturn = objMod.Suppressive;
				}

				return intReturn;
			}
		}

		/// <summary>
		/// Total Accessory Cost multiplier for the Weapon.
		/// </summary>
		public int AccessoryMultiplier
		{
			get
			{
				int intReturn = 0;
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.AccessoryCostMultiplier != 1)
						intReturn += objMod.AccessoryCostMultiplier;
				}

				if (intReturn == 0)
					intReturn = 1;

				return intReturn;
			}
		}

		/// <summary>
		/// Total Mod Cost multiplier for the Weapon.
		/// </summary>
		public int ModMultiplier
		{
			get
			{
				int intReturn = 0;
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.ModCostMultiplier != 1)
						intReturn += objMod.ModCostMultiplier;
					if (objMod.Cost.Contains("Total Cost"))
						intReturn += Convert.ToInt32(objMod.Cost.Replace("Total Cost * ", string.Empty));
				}

				if (intReturn == 0)
					intReturn = 1;

				return intReturn;
			}
		}

		/// <summary>
		/// The Dice Pool size for the Active Skill required to use the Weapon.
		/// </summary>
		public string DicePool
		{
			get
			{
				string strCategory = _strCategory;
				string strSkill = "";
				string strSpec = "";
				string strReturn = "";

				// If this is a Special Weapon, use the Range to determine the required Active Skill (if present).
				if (strCategory == "Special Weapons" && _strRange != "")
					strCategory = _strRange;

				// Exotic Skills require a matching Specialization.
				switch (strCategory)
				{
					case "Bows":
					case "Crossbows":
						strSkill = "Archery";
						break;
					case "Assault Rifles":
					case "Machine Pistols":
					case "Submachine Guns":
					case "Battle Rifles":
						strSkill = "Automatics";
						break;
					case "Blades":
					case "Cyberware Blades":
						strSkill = "Blades";
						break;
					case "Clubs":
						strSkill = "Clubs";
						break;
					case "Exotic Melee Weapons":
					case "Cyberware Exotic Melee Weapons":
						strSkill = "Exotic Melee Weapon";
						strSpec = DisplayNameShort;
						break;
					case "Exotic Ranged Weapons":
					case "Cyberware Exotic Ranged Weapons":
					case "Cyberware Hold-Outs":
					case "Cyberware Light Pistols":
					case "Cyberware Machine Pistols":
					case "Cyberware Heavy Pistols":
					case "Cyberware Submachine Guns":
					case "Cyberware Shotguns":
					case "Cyberware Grenade Launchers":
					case "Cyberware Tasers":
						strSkill = "Exotic Ranged Weapon";
						strSpec = DisplayNameShort;
						break;
					case "Flamethrowers":
						strSkill = "Exotic Ranged Weapon";
						strSpec = "Flamethrowers";
						break;
					case "Laser Weapons":
						strSkill = "Exotic Ranged Weapon";
						strSpec = "Laser Weapons";
						break;
					case "Assault Cannons":
					case "Grenade Launchers":
					case "Missile Launchers":
					case "Mortar Launchers":
					case "Light Machine Guns":
					case "Medium Machine Guns":
					case "Heavy Machine Guns":
						strSkill = "Heavy Weapons";
						break;
					case "Shotguns":
					case "Sniper Rifles":
					case "Sports Rifles":
						strSkill = "Longarms";
						break;
					case "Throwing Weapons":
					case "Cyberware Throwing Weapons":
						strSkill = "Throwing Weapons";
						break;
					case "Unarmed":
					case "Cyberware Clubs":
					case "Cyberware":
						strSkill = "Unarmed Combat";
						break;
					default:
						strSkill = "Pistols";
						break;
				}

				// Use the Skill defined by the Weapon if one is present.
				if (_strUseSkill != string.Empty)
				{
					strSkill = _strUseSkill;
					strSpec = "";

					if (_strUseSkill.Contains("Exotic"))
						strSpec = DisplayNameShort;
				}

				// Locate the Active Skill to be used.
				Skill objSkill = new Skill(_objCharacter);
				foreach (Skill objCharacterSkill in _objCharacter.Skills)
				{
					if (!objCharacterSkill.KnowledgeSkill && objCharacterSkill.Name == strSkill)
					{
						if (strSpec == "" || (strSpec != "" && objCharacterSkill.Specialization == strSpec))
						{
							objSkill = objCharacterSkill;
							break;
						}
					}
				}

				int intSmartlinkBonus = 0;
				int intDicePoolModifier = 0;
				// Determine if the Weapon has Smartgun.
				bool blnHasSmartgun = false;
				foreach (WeaponAccessory objAccessory in _lstAccessories)
				{
					if (objAccessory.Name.StartsWith("Smartgun System") && objAccessory.Installed)
						blnHasSmartgun = true;

					if (objAccessory.Installed)
						intDicePoolModifier += objAccessory.DicePool;
				}

				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.Name.StartsWith("Smartgun System") && objMod.Installed)
						blnHasSmartgun = true;

					// Include any Dice Pool modifier that comes from the Mod.
					if (objMod.Installed)
						intDicePoolModifier += objMod.DicePool;
				}

				if (blnHasSmartgun)
				{
					if (objSkill.Name == "Automatics" || objSkill.Name == "Exotic Ranged Weapon" || objSkill.Name == "Heavy Weapons" || objSkill.Name == "Longarms" || objSkill.Name == "Pistols")
					{
						// Check to see if the character has the Smartlink Improvement.
						foreach (Improvement objImprovement in _objCharacter.Improvements)
						{
							if (objImprovement.ImproveType == Improvement.ImprovementType.Smartlink && objImprovement.Enabled)
								intSmartlinkBonus = 2;
						}
					}
				}

				foreach (Gear objGear in _objCharacter.Gear)
				{
					if (objGear.InternalId == AmmoLoaded)
					{
						if (objGear.WeaponBonus != null)
						{
							if (objGear.WeaponBonus["pool"] != null)
								intDicePoolModifier += Convert.ToInt32(objGear.WeaponBonus["pool"].InnerText);
						}
					}
				}

				int intRating = objSkill.TotalRating + intSmartlinkBonus + intDicePoolModifier;
				strReturn = intRating.ToString();

				// If the character has a Specialization, include it in the Dice Pool string.
				if (objSkill.Specialization != "" && !objSkill.ExoticSkill)
				{
					if (objSkill.Specialization == DisplayNameShort || objSkill.Specialization == _strName || objSkill.Specialization == DisplayCategory || objSkill.Specialization == _strCategory || (objSkill.Specialization != string.Empty && (objSkill.Specialization == _strSpec || objSkill.Specialization == _strSpec2)))
						strReturn += " (" + (intRating + 2).ToString() + ")";
				}

				return strReturn;
			}
		}

		/// <summary>
		/// Tooltip information for the Dice Pool.
		/// </summary>
		public string DicePoolTooltip
		{
			get
			{
				string strCategory = _strCategory;
				string strSkill = "";
				string strSpec = "";
				string strReturn = "";

				// If this is a Special Weapon, use the Range to determine the required Active Skill (if present).
				if (strCategory == "Special Weapons" && _strRange != "")
					strCategory = _strRange;

				// Exotic Skills require a matching Specialization.
				switch (strCategory)
				{
					case "Bows":
					case "Crossbows":
						strSkill = "Archery";
						break;
					case "Assault Rifles":
					case "Machine Pistols":
					case "Submachine Guns":
					case "Battle Rifles":
						strSkill = "Automatics";
						break;
					case "Blades":
					case "Cyberware Blades":
						strSkill = "Blades";
						break;
					case "Clubs":
						strSkill = "Clubs";
						break;
					case "Exotic Melee Weapons":
					case "Cyberware Exotic Melee Weapons":
						strSkill = "Exotic Melee Weapon";
						strSpec = DisplayNameShort;
						break;
					case "Exotic Ranged Weapons":
					case "Cyberware Exotic Ranged Weapons":
					case "Cyberware Hold-Outs":
					case "Cyberware Light Pistols":
					case "Cyberware Machine Pistols":
					case "Cyberware Heavy Pistols":
					case "Cyberware Submachine Guns":
					case "Cyberware Shotguns":
					case "Cyberware Grenade Launchers":
					case "Cyberware Tasers":
						strSkill = "Exotic Ranged Weapon";
						strSpec = DisplayNameShort;
						break;
					case "Flamethrowers":
						strSkill = "Exotic Ranged Weapon";
						strSpec = "Flamethrowers";
						break;
					case "Laser Weapons":
						strSkill = "Exotic Ranged Weapon";
						strSpec = "Laser Weapons";
						break;
					case "Assault Cannons":
					case "Grenade Launchers":
					case "Missile Launchers":
					case "Mortar Launchers":
					case "Light Machine Guns":
					case "Medium Machine Guns":
					case "Heavy Machine Guns":
						strSkill = "Heavy Weapons";
						break;
					case "Shotguns":
					case "Sniper Rifles":
					case "Sports Rifles":
						strSkill = "Longarms";
						break;
					case "Throwing Weapons":
					case "Cyberware Throwing Weapons":
						strSkill = "Throwing Weapons";
						break;
					case "Unarmed":
					case "Cyberware Clubs":
					case "Cyberware":
						strSkill = "Unarmed Combat";
						break;
					default:
						strSkill = "Pistols";
						break;
				}

				// Use the Skill defined by the Weapon if one is present.
				if (_strUseSkill != string.Empty)
					strSkill = _strUseSkill;

				// Locate the Active Skill to be used.
				Skill objSkill = new Skill(_objCharacter);
				foreach (Skill objCharacterSkill in _objCharacter.Skills)
				{
					if (!objCharacterSkill.KnowledgeSkill && objCharacterSkill.Name == strSkill)
					{
						if (strSpec == "" || (strSpec != "" && objCharacterSkill.Specialization == strSpec))
						{
							objSkill = objCharacterSkill;
							break;
						}
					}
				}

				strReturn = strSkill + " (" + objSkill.TotalRating + ")";

				int intSmartlinkBonus = 0;
				// Determine if the Weapon has Smartgun.
				bool blnHasSmartgun = false;
				foreach (WeaponAccessory objAccessory in _lstAccessories)
				{
					if (objAccessory.Name.StartsWith("Smartgun System") && objAccessory.Installed)
						blnHasSmartgun = true;

					if (objAccessory.Installed && objAccessory.DicePool != 0)
						strReturn += " + " + objAccessory.DisplayNameShort + " (" + objAccessory.DicePool.ToString() + ")";
				}

				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.Name.StartsWith("Smartgun System") && objMod.Installed)
						blnHasSmartgun = true;

					// Include any Dice Pool modifier that comes from the Mod.
					if (objMod.Installed && objMod.DicePool != 0)
						strReturn += " + " + objMod.DisplayNameShort + " (" + objMod.DicePool.ToString() + ")";
				}

				foreach (Gear objGear in _objCharacter.Gear)
				{
					if (objGear.InternalId == AmmoLoaded)
					{
						if (objGear.WeaponBonus != null)
						{
							if (objGear.WeaponBonus["pool"] != null)
								strReturn += " + " + objGear.DisplayNameShort + " (" + Convert.ToInt32(objGear.WeaponBonus["pool"].InnerText) + ")";
						}
					}
				}

				if (blnHasSmartgun)
				{
					if (objSkill.Name == "Automatics" || objSkill.Name == "Exotic Ranged Weapon" || objSkill.Name == "Heavy Weapons" || objSkill.Name == "Longarms" || objSkill.Name == "Pistols")
					{
						// Check to see if the character has the Smartlink Improvement.
						foreach (Improvement objImprovement in _objCharacter.Improvements)
						{
							if (objImprovement.ImproveType == Improvement.ImprovementType.Smartlink && objImprovement.Enabled)
								intSmartlinkBonus = 2;
						}
					}
				}

				if (objSkill.Specialization != "" && !objSkill.ExoticSkill)
				{
					if (objSkill.Specialization == DisplayNameShort || objSkill.Specialization == _strName || objSkill.Specialization == DisplayCategory || objSkill.Specialization == _strCategory || (objSkill.Specialization != string.Empty && (objSkill.Specialization == _strSpec || objSkill.Specialization == _strSpec2)))
						strReturn += " + " + LanguageManager.Instance.GetString("String_ExpenseSpecialization") + " (2)";
				}

				if (intSmartlinkBonus != 0)
					strReturn += " + " + LanguageManager.Instance.GetString("Tip_Skill_Smartlink") + " (" + intSmartlinkBonus + ")";

				return strReturn;
			}
		}

		/// <summary>
		/// Total Availability.
		/// </summary>
		public string TotalAvail
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

		// Run through the Weapon Mods and see if anything changes the cost multiplier (Vintage mod).
		public int CostMultiplier
		{
			get
			{
				int intReturn = 1;
				foreach (WeaponMod objMod in _lstWeaponMods)
				{
					if (objMod.AccessoryCostMultiplier > 1 || objMod.ModCostMultiplier > 1)
						intReturn = objMod.AccessoryCostMultiplier;
				}

				return intReturn;
			}
		}
		#endregion
	}

	/// <summary>
	/// Weapon Accessory.
	/// </summary>
	public class WeaponAccessory
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private string _strMount = "";
		private string _strRC = "";
		private int _intRCGroup = 0;
		private int _intConceal = 0;
		private string _strAvail = "";
		private string _strCost = "";
		private bool _blnIncludedInWeapon = false;
		private bool _blnInstalled = true;
		private string _strSource = "";
		private string _strPage = "";
		private string _strNotes = "";
		private readonly Character _objCharacter;
		private string _strAltName = "";
		private string _strAltPage = "";
		private XmlNode _nodAllowGear;
		private List<Gear> _lstGear = new List<Gear>();
		private bool _blnDiscountCost = false;
		private Weapon _objParent;
		private string _strDicePool = "";

		#region Constructor, Create, Save, Load, and Print Methods
		public WeaponAccessory(Character objCharacter)
		{
			// Create the GUID for the new Weapon.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Weapon Accessory from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlAccessory">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		/// <param name="strMount">Mount slot that the Weapon Accessory will consume.</param>
		public void Create(XmlNode objXmlAccessory, TreeNode objNode, string strMount)
		{
			_strName = objXmlAccessory["name"].InnerText;
			_strMount = strMount;
			if (objXmlAccessory.InnerXml.Contains("<rc>"))
				_strRC = objXmlAccessory["rc"].InnerText;
			if (objXmlAccessory.InnerXml.Contains("<rcgroup>"))
				_intRCGroup = Convert.ToInt32(objXmlAccessory["rcgroup"].InnerText);
			if (objXmlAccessory.InnerXml.Contains("<conceal>"))
				_intConceal = Convert.ToInt32(objXmlAccessory["conceal"].InnerText);
			_strAvail = objXmlAccessory["avail"].InnerText;
			_strCost = objXmlAccessory["cost"].InnerText;
			_strSource = objXmlAccessory["source"].InnerText;
			_strPage = objXmlAccessory["page"].InnerText;
			_nodAllowGear = objXmlAccessory["allowgear"];
			try
			{
				_strDicePool = objXmlAccessory["dicepool"].InnerText;
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objAccessoryNode = objXmlDocument.SelectSingleNode("/chummer/accessories/accessory[name = \"" + _strName + "\"]");
				if (objAccessoryNode != null)
				{
					if (objAccessoryNode["translate"] != null)
						_strAltName = objAccessoryNode["translate"].InnerText;
					if (objAccessoryNode["altpage"] != null)
						_strAltPage = objAccessoryNode["altpage"].InnerText;
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
			objWriter.WriteStartElement("accessory");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("mount", _strMount);
			objWriter.WriteElementString("rc", _strRC);
			objWriter.WriteElementString("rcgroup", _intRCGroup.ToString());
			objWriter.WriteElementString("conceal", _intConceal.ToString());
			if (_strDicePool != "")
				objWriter.WriteElementString("dicepool", _strDicePool);
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("cost", _strCost);
			objWriter.WriteElementString("included", _blnIncludedInWeapon.ToString());
			objWriter.WriteElementString("installed", _blnInstalled.ToString());
			if (_nodAllowGear != null)
				objWriter.WriteRaw(_nodAllowGear.OuterXml);
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
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
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_strName = objNode["name"].InnerText;
			_strMount = objNode["mount"].InnerText;
			_strRC = objNode["rc"].InnerText;
			try
			{
				_intRCGroup = Convert.ToInt32(objNode["rcgroup"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intConceal = Convert.ToInt32(objNode["conceal"].InnerText);
			}
			catch
			{
			}
			_strAvail = objNode["avail"].InnerText;
			_strCost = objNode["cost"].InnerText;
			_blnIncludedInWeapon = Convert.ToBoolean(objNode["included"].InnerText);
			try
			{
				_blnInstalled = Convert.ToBoolean(objNode["installed"].InnerText);
			}
			catch
			{
			}
			try
			{
				_nodAllowGear = objNode["allowgear"];
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
				_strDicePool = objNode["dicepool"].InnerText;
			}
			catch
			{
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

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objAccessoryNode = objXmlDocument.SelectSingleNode("/chummer/accessories/accessory[name = \"" + _strName + "\"]");
				if (objAccessoryNode != null)
				{
					if (objAccessoryNode["translate"] != null)
						_strAltName = objAccessoryNode["translate"].InnerText;
					if (objAccessoryNode["altpage"] != null)
						_strAltPage = objAccessoryNode["altpage"].InnerText;
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
			objWriter.WriteStartElement("accessory");
			objWriter.WriteElementString("name", DisplayName);
			objWriter.WriteElementString("mount", _strMount);
			objWriter.WriteElementString("rc", _strRC);
			objWriter.WriteElementString("conceal", _intConceal.ToString());
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("included", _blnIncludedInWeapon.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
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
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this Weapon.
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
		/// The name of the object as it should be displayed in lists. Name (Extra).
		/// </summary>
		public string DisplayName
		{
			get
			{
				string strReturn = DisplayNameShort;

				return strReturn;
			}
		}

		/// <summary>
		/// Mount Used.
		/// </summary>
		public string Mount
		{
			get
			{
				return _strMount;
			}
			set
			{
				_strMount = value;
			}
		}

		/// <summary>
		/// Recoil.
		/// </summary>
		public string RC
		{
			get
			{
				return _strRC;
			}
			set
			{
				_strRC = value;
			}
		}

		/// <summary>
		/// Recoil Group.
		/// </summary>
		public int RCGroup
		{
			get
			{
				return _intRCGroup;
			}
		}

		/// <summary>
		/// Concealability.
		/// </summary>
		public int Concealability
		{
			get
			{
				return _intConceal;
			}
			set
			{
				_intConceal = value;
			}
		}

		/// <summary>
		/// Avail.
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
				// The Accessory has a cost of 0 if it is included in the base weapon configureation.
				if (_blnIncludedInWeapon)
					return "0";
				else
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
		/// Whether or not this Accessory is part of the base weapon configuration.
		/// </summary>
		public bool IncludedInWeapon
		{
			get
			{
				return _blnIncludedInWeapon;
			}
			set
			{
				_blnIncludedInWeapon = value;
			}
		}

		/// <summary>
		/// Whether or not this Accessory is installed and contributing towards the Weapon's stats.
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
		/// Total Availability.
		/// </summary>
		public string TotalAvail
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

		/// <summary>
		/// Parent Weapon.
		/// </summary>
		public Weapon Parent
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
		/// Total cost of the Weapon Accessory.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intReturn = 0;

				if (_strCost == "Weapon Cost")
					intReturn = _objParent.Cost * _objParent.CostMultiplier;
				else
					intReturn = Convert.ToInt32(_strCost) * _objParent.CostMultiplier;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				// Add in the cost of any Gear the Weapon Accessory has attached to it.
				foreach (Gear objGear in _lstGear)
					intReturn += objGear.TotalCost;

				return intReturn;
			}
		}

		/// <summary>
		/// The cost of just the Weapon Accessory itself.
		/// </summary>
		public int OwnCost
		{
			get
			{
				int intReturn = 0;

				if (_strCost == "Weapon Cost")
					intReturn = _objParent.Cost * _objParent.CostMultiplier;
				else
					intReturn = Convert.ToInt32(_strCost) * _objParent.CostMultiplier;

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intReturn;
			}
		}

		/// <summary>
		/// Dice Pool modifier.
		/// </summary>
		public int DicePool
		{
			get
			{
				int intReturn = 0;

				if (_strDicePool != string.Empty)
					intReturn = Convert.ToInt32(_strDicePool);

				return intReturn;
			}
		}

		private string DicePoolString
		{
			get
			{
				return _strDicePool;
			}
		}
		#endregion
	}

	/// <summary>
	/// Weapon Modification.
	/// </summary>
	public class WeaponMod
	{
		private Guid _guiID = new Guid();
		private string _strName = "";
		private int _intSlots = 0;
		private string _strCost = "";
		private string _strRC = "";
		private int _intRCGroup = 0;
		private int _intConceal = 0;
		private string _strAvail = "";
		private string _strSource = "";
		private string _strPage = "";
		private string _strAddMode = "";
		private int _intAmmoBonus = 0;
		private string _strAmmoReplace = "";
		private int _intDVBonus = 0;
		private int _intAPBonus = 0;
		private int _intRangeBonus = 0;
		private int _intRating = 0;
		private int _intAccessoryCostMultiplier = 1;
		private int _intModCostMultiplier = 1;
		private int _intFullBurst = 0;
		private int _intSuppressive = 0;
		private string _strDicePool = "";
		private bool _blnIncludedInWeapon = false;
		private bool _blnInstalled = true;
		private string _strNotes = "";
		private readonly Character _objCharacter;
		private string _strAltName = "";
		private string _strAltPage = "";
		private string _strExtra = "";
		private bool _blnDiscountCost = false;
		private Weapon _objParent;

		#region Constructor, Create, Save, Load, and Print Methods
		public WeaponMod(Character objCharacter)
		{
			// Create the GUID for the new Mod.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// Create a Weapon Modification from an XmlNode and return the TreeNodes for it.
		/// <param name="objXmlMod">XmlNode to create the object from.</param>
		/// <param name="objNode">TreeNode to populate a TreeView.</param>
		public void Create(XmlNode objXmlMod, TreeNode objNode)
		{
			_strName = objXmlMod["name"].InnerText;
			_intSlots = Convert.ToInt32(objXmlMod["slots"].InnerText);
			_strAvail = objXmlMod["avail"].InnerText;
			if (objXmlMod.InnerXml.Contains("<rc>"))
				_strRC = objXmlMod["rc"].InnerText;
			if (objXmlMod.InnerXml.Contains("<rcgroup>"))
				_intRCGroup = Convert.ToInt32(objXmlMod["rcgroup"].InnerText);
			if (objXmlMod.InnerXml.Contains("<conceal>"))
				_intConceal = Convert.ToInt32(objXmlMod["conceal"].InnerText);
			_strCost = objXmlMod["cost"].InnerText;
			_strSource = objXmlMod["source"].InnerText;
			_strPage = objXmlMod["page"].InnerText;
			try
			{
				_intAmmoBonus = Convert.ToInt32(objXmlMod["ammobonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strAmmoReplace = objXmlMod["ammoreplace"].InnerText;
			}
			catch
			{
			}
			try
			{
				_intAccessoryCostMultiplier = Convert.ToInt32(objXmlMod["accessorycostmultiplier"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intModCostMultiplier = Convert.ToInt32(objXmlMod["modcostmultiplier"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strAddMode = objXmlMod["addmode"].InnerText;
			}
			catch
			{
			}
			try
			{
				_intFullBurst = Convert.ToInt32(objXmlMod["fullburst"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSuppressive = Convert.ToInt32(objXmlMod["suppressive"].InnerText);
			}
			catch
			{
			}

			try
			{
				_intDVBonus = Convert.ToInt32(objXmlMod["dvbonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intAPBonus = Convert.ToInt32(objXmlMod["apbonus"].InnerText);
			}
			catch
			{
			}

			try
			{
				_intRangeBonus = Convert.ToInt32(objXmlMod["rangebonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strDicePool = objXmlMod["dicepool"].InnerText;
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objModNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objModNode != null)
				{
					if (objModNode["translate"] != null)
						_strAltName = objModNode["translate"].InnerText;
					if (objModNode["altpage"] != null)
						_strAltPage = objModNode["altpage"].InnerText;
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
			objWriter.WriteStartElement("weaponmod");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("name", _strName);
			objWriter.WriteElementString("slots", _intSlots.ToString());
			objWriter.WriteElementString("avail", _strAvail);
			objWriter.WriteElementString("rc", _strRC);
			objWriter.WriteElementString("rcgroup", _intRCGroup.ToString());
			objWriter.WriteElementString("dvbonus", _intDVBonus.ToString());
			objWriter.WriteElementString("apbonus", _intAPBonus.ToString());
			objWriter.WriteElementString("conceal", _intConceal.ToString());
			objWriter.WriteElementString("cost", _strCost);
			objWriter.WriteElementString("included", _blnIncludedInWeapon.ToString());
			objWriter.WriteElementString("installed", _blnInstalled.ToString());
			objWriter.WriteElementString("rating", _intRating.ToString());
			if (_intAmmoBonus != 0)
				objWriter.WriteElementString("ammobonus", _intAmmoBonus.ToString());
			if (_strAmmoReplace != "")
				objWriter.WriteElementString("ammoreplace", _strAmmoReplace);
			if (_intAccessoryCostMultiplier != 1)
				objWriter.WriteElementString("accessorycostmultiplier", _intAccessoryCostMultiplier.ToString());
			if (_intModCostMultiplier != 1)
				objWriter.WriteElementString("modcostmultiplier", _intModCostMultiplier.ToString());
			if (_strAddMode != "")
				objWriter.WriteElementString("addmode", _strAddMode);
			if (_strDicePool != "")
				objWriter.WriteElementString("dicepool", _strDicePool);
			objWriter.WriteElementString("fullburst", _intFullBurst.ToString());
			objWriter.WriteElementString("suppressive", _intSuppressive.ToString());
			objWriter.WriteElementString("rangebonus", _intRangeBonus.ToString());
			objWriter.WriteElementString("extra", _strExtra);
			objWriter.WriteElementString("source", _strSource);
			objWriter.WriteElementString("page", _strPage);
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
			_intSlots = Convert.ToInt32(objNode["slots"].InnerText);
			_strAvail = objNode["avail"].InnerText;
			try
			{
				_strRC = objNode["rc"].InnerText;
			}
			catch
			{
			}
			try
			{
				_intRCGroup = Convert.ToInt32(objNode["rcgroup"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intConceal = Convert.ToInt32(objNode["conceal"].InnerText);
			}
			catch
			{
			}
			_strCost = objNode["cost"].InnerText;
			_blnIncludedInWeapon = Convert.ToBoolean(objNode["included"].InnerText);
			try
			{
				_blnInstalled = Convert.ToBoolean(objNode["installed"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intRating = Convert.ToInt32(objNode["rating"].InnerText);
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
				_intAmmoBonus = Convert.ToInt32(objNode["ammobonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strAmmoReplace = objNode["ammoreplace"].InnerText;
			}
			catch
			{
			}
			try
			{
				_intAccessoryCostMultiplier = Convert.ToInt32(objNode["accessorycostmultiplier"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intModCostMultiplier = Convert.ToInt32(objNode["modcostmultiplier"].InnerText);
			}
			catch
			{
			}
			try
			{
				_strAddMode = objNode["addmode"].InnerText;
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
				_intFullBurst = Convert.ToInt32(objNode["fullburst"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intSuppressive = Convert.ToInt32(objNode["suppressive"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intDVBonus = Convert.ToInt32(objNode["dvbonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intAPBonus = Convert.ToInt32(objNode["apbonus"].InnerText);
			}
			catch
			{
			}
			try
			{
				_intRangeBonus = Convert.ToInt32(objNode["rangebonus"].InnerText);
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
				_strDicePool = objNode["dicepool"].InnerText;
			}
			catch
			{
			}

			if (GlobalOptions.Instance.Language != "en-us")
			{
				XmlDocument objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objModNode = objXmlDocument.SelectSingleNode("/chummer/mods/mod[name = \"" + _strName + "\"]");
				if (objModNode != null)
				{
					if (objModNode["translate"] != null)
						_strAltName = objModNode["translate"].InnerText;
					if (objModNode["altpage"] != null)
						_strAltPage = objModNode["altpage"].InnerText;
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
			objWriter.WriteStartElement("weaponmod");
			objWriter.WriteElementString("name", DisplayNameShort);
			objWriter.WriteElementString("slots", _intSlots.ToString());
			objWriter.WriteElementString("avail", TotalAvail);
			objWriter.WriteElementString("rc", _strRC);
			objWriter.WriteElementString("rating", _intRating.ToString());
			objWriter.WriteElementString("cost", TotalCost.ToString());
			objWriter.WriteElementString("owncost", OwnCost.ToString());
			objWriter.WriteElementString("included", _blnIncludedInWeapon.ToString());
			objWriter.WriteElementString("source", _objCharacter.Options.LanguageBookShort(_strSource));
			objWriter.WriteElementString("page", Page);
			if (_objCharacter.Options.PrintNotes)
				objWriter.WriteElementString("notes", _strNotes);
			objWriter.WriteEndElement();
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this VehicleWeaponMod.
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
		/// Slots used by the Mod.
		/// </summary>
		public int Slots
		{
			get
			{
				return _intSlots;
			}
			set
			{
				_intSlots = value;
			}
		}

		/// <summary>
		/// Concealability.
		/// </summary>
		public int Concealability
		{
			get
			{
				return _intConceal;
			}
			set
			{
				_intConceal = value;
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
		/// Recoil.
		/// </summary>
		public string RC
		{
			get
			{
				return _strRC;
			}
			set
			{
				_strRC = value;
			}
		}

		/// <summary>
		/// Recoil Group.
		/// </summary>
		public int RCGroup
		{
			get
			{
				return _intRCGroup;
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
		/// Whether or not this Mod is part of the base weapon configuration.
		/// </summary>
		public bool IncludedInWeapon
		{
			get
			{
				return _blnIncludedInWeapon;
			}
			set
			{
				_blnIncludedInWeapon = value;
			}
		}

		/// <summary>
		/// Whether or not this Mod is installed and contributing towards the Weapon's stats.
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

		/// <summary>
		/// Adjust the Weapon's Ammo amount by the specified percent.
		/// </summary>
		public int AmmoBonus
		{
			get
			{
				return _intAmmoBonus;
			}
			set
			{
				_intAmmoBonus = value;
			}
		}

		/// <summary>
		/// Replace the Weapon's Ammo value with the Weapon Mod's value.
		/// </summary>
		public string AmmoReplace
		{
			get
			{
				return _strAmmoReplace;
			}
			set
			{
				_strAmmoReplace = value;
			}
		}

		/// <summary>
		/// Accessory cost multiplier (comes from the Vintage mod).
		/// </summary>
		public int AccessoryCostMultiplier
		{
			get
			{
				return _intAccessoryCostMultiplier;
			}
			set
			{
				_intAccessoryCostMultiplier = value;
			}
		}

		/// <summary>
		/// Mod cost multiplier (comes from the Vintage mod).
		/// </summary>
		public int ModCostMultiplier
		{
			get
			{
				return _intModCostMultiplier;
			}
			set
			{
				_intModCostMultiplier = value;
			}
		}

		/// <summary>
		/// Additional Weapon Firing Mode.
		/// </summary>
		public string AddMode
		{
			get
			{
				return _strAddMode;
			}
			set
			{
				_strAddMode = value;
			}
		}

		/// <summary>
		/// Weapon Mod Rating.
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
		/// Number of rounds consumed by Full Burst.
		/// </summary>
		public int FullBurst
		{
			get
			{
				return _intFullBurst;
			}
		}

		/// <summary>
		/// Number of rounds consumed by Suppressive Fire.
		/// </summary>
		public int Suppressive
		{
			get
			{
				return _intSuppressive;
			}
		}

		/// <summary>
		/// Range bonus granted by the Modification.
		/// </summary>
		public int RangeBonus
		{
			get
			{
				return _intRangeBonus;
			}
		}

		/// <summary>
		/// DV bonus granted by the Modification.
		/// </summary>
		public int DVBonus
		{
			get
			{
				return _intDVBonus;
			}
		}

		/// <summary>
		/// AP bonus granted by the Modification.
		/// </summary>
		public int APBonus
		{
			get
			{
				return _intAPBonus;
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

		/// <summary>
		/// Parent Weapon.
		/// </summary>
		public Weapon Parent
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
		/// Total Availability.
		/// </summary>
		public string TotalAvail
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
		/// Dice Pool modifier.
		/// </summary>
		public int DicePool
		{
			get
			{
				int intReturn = 0;

				if (_strDicePool != string.Empty)
				{
					if (_strDicePool == "Rating")
						intReturn = _intRating;
					else if (_strDicePool == "-Rating")
						intReturn = _intRating * -1;
					else
						intReturn = Convert.ToInt32(_strDicePool);
				}

				return intReturn;
			}
		}

		private string DicePoolString
		{
			get
			{
				return _strDicePool;
			}
		}

		/// <summary>
		/// Total cost of the Weapon Mod.
		/// </summary>
		public int TotalCost
		{
			get
			{
				int intReturn = 0;

				if (_strCost.StartsWith("Total Cost"))
				{
					int intMultiplier = Convert.ToInt32(_strCost.Replace("Total Cost * ", string.Empty));
					intReturn = _objParent.MultipliableCost * intMultiplier;
				}
				else
				{
					XmlDocument objXmlDocument = new XmlDocument();
					XPathNavigator nav = objXmlDocument.CreateNavigator();

					string strCost = "";
					string strCostExpression = _strCost;

					strCost = strCostExpression.Replace("Weapon Cost", _objParent.Cost.ToString());
					strCost = strCost.Replace("Rating", _intRating.ToString());
					XPathExpression xprCost = nav.Compile(strCost);
					intReturn = (Convert.ToInt32(nav.Evaluate(xprCost).ToString()) * _objParent.CostMultiplier);
				}

				if (DiscountCost)
					intReturn = Convert.ToInt32(Convert.ToDouble(intReturn, GlobalOptions.Instance.CultureInfo) * 0.9);

				return intReturn;
			}
		}

		/// <summary>
		/// The cost of just the Weapon Mod itself.
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