using System;
using System.Collections.Generic;
using System.Xml;

namespace Chummer
{
	/// <summary>
	/// A Stacked Focus.
	/// </summary>
	public class StackedFocus
	{
		private Guid _guiID = new Guid();
		private bool _blnBonded = false;
		private Guid _guiGearId = new Guid();
		private List<Gear> _lstGear = new List<Gear>();
		private readonly Character _objCharacter;

		#region Constructor, Create, Save, and Load Methods
		public StackedFocus(Character objCharacter)
		{
			// Create the GUID for the new Focus.
			_guiID = Guid.NewGuid();
			_objCharacter = objCharacter;
		}

		/// <summary>
		/// Save the object's XML to the XmlWriter.
		/// </summary>
		/// <param name="objWriter">XmlTextWriter to write with.</param>
		public void Save(XmlTextWriter objWriter)
		{
			objWriter.WriteStartElement("stackedfocus");
			objWriter.WriteElementString("guid", _guiID.ToString());
			objWriter.WriteElementString("gearid", _guiGearId.ToString());
			objWriter.WriteElementString("bonded", _blnBonded.ToString());
			objWriter.WriteStartElement("gears");
			foreach (Gear objGear in _lstGear)
				objGear.Save(objWriter);
			objWriter.WriteEndElement();
			objWriter.WriteEndElement();
		}

		/// <summary>
		/// Load the Stacked Focus from the XmlNode.
		/// </summary>
		/// <param name="objNode">XmlNode to load.</param>
		public void Load(XmlNode objNode)
		{
			_guiID = Guid.Parse(objNode["guid"].InnerText);
			_guiGearId = Guid.Parse(objNode["gearid"].InnerText);
			_blnBonded = Convert.ToBoolean(objNode["bonded"].InnerText);
			XmlNodeList nodGears = objNode.SelectNodes("gears/gear");
			foreach (XmlNode nodGear in nodGears)
			{
				Gear objGear = new Gear(_objCharacter);
				objGear.Load(nodGear);
				_lstGear.Add(objGear);
			}
		}
		#endregion

		#region Properties
		/// <summary>
		/// Internal identifier which will be used to identify this Stacked Focus in the Improvement system.
		/// </summary>
		public string InternalId
		{
			get
			{
				return _guiID.ToString();
			}
		}

		/// <summary>
		/// GUID of the linked Gear.
		/// </summary>
		public string GearId
		{
			get
			{
				return _guiGearId.ToString();
			}
			set
			{
				_guiGearId = Guid.Parse(value);
			}
		}

		/// <summary>
		/// Whether or not the Stacked Focus in Bonded.
		/// </summary>
		public bool Bonded
		{
			get
			{
				return _blnBonded;
			}
			set
			{
				_blnBonded = value;
			}
		}

		/// <summary>
		/// The Stacked Focus' total Force.
		/// </summary>
		public int TotalForce
		{
			get
			{
				int intReturn = 0;
				foreach (Gear objGear in _lstGear)
					intReturn += objGear.Rating;

				return intReturn;
			}
		}

		/// <summary>
		/// The cost in Karma to bind this Stacked Focus.
		/// </summary>
		public int BindingCost
		{
			get
			{
				int intCost = 0;
				foreach (Gear objFocus in _lstGear)
				{
					// Each Focus costs an amount of Karma equal to their Force x speicific Karma cost.
					string strFocusName = objFocus.Name;
					int intPosition = strFocusName.IndexOf("(");
					if (intPosition > -1)
						strFocusName = strFocusName.Substring(0, intPosition - 1);
					int intKarmaMultiplier = 0;
					switch (strFocusName)
					{
						case "Symbolic Link Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaSymbolicLinkFocus;
							break;
						case "Sustaining Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaSustainingFocus;
							break;
						case "Counterspelling Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaCounterspellingFocus;
							break;
						case "Banishing Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaBanishingFocus;
							break;
						case "Binding Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaBindingFocus;
							break;
						case "Weapon Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaWeaponFocus;
							break;
						case "Spellcasting Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaSpellcastingFocus;
							break;
						case "Summoning Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaSummoningFocus;
							break;
						case "Anchoring Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaAnchoringFocus;
							break;
						case "Centering Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaCenteringFocus;
							break;
						case "Masking Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaMaskingFocus;
							break;
						case "Shielding Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaShieldingFocus;
							break;
						case "Power Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaPowerFocus;
							break;
						case "Divining Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaDiviningFocus;
							break;
						case "Dowsing Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaDowsingFocus;
							break;
						case "Infusion Focus":
							intKarmaMultiplier = _objCharacter.Options.KarmaInfusionFocus;
							break;
						default:
							intKarmaMultiplier = 1;
							break;
					}
					intCost += (objFocus.Rating * intKarmaMultiplier);
				}
				return intCost;
			}
		}

		/// <summary>
		/// Stacked Focus Name.
		/// </summary>
		public string Name
		{
			get
			{
				string strReturn = "";
				foreach (Gear objGear in _lstGear)
					strReturn += objGear.DisplayName + ", ";

				// Remove the trailing comma.
				if (strReturn != string.Empty)
					strReturn = strReturn.Substring(0, strReturn.Length - 2);

				return strReturn;
			}
		}

		/// <summary>
		/// List of Gear that make up the Stacked Focus.
		/// </summary>
		public List<Gear> Gear
		{
			get
			{
				return _lstGear;
			}
			set
			{
				_lstGear = value;
			}
		}
		#endregion
	}
}
