using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using System.Xml;

namespace Chummer
{
	public sealed class LanguageManager
	{
		/// <summary>
		/// An individual language string.
		/// </summary>
		private class LanguageString
		{
			private string _strKey = "";
			private string _strText = "";

			/// <summary>
			/// String's unique Key.
			/// </summary>
			public string Key
			{
				get
				{
					return _strKey;
				}
				set
				{
					_strKey = value;
				}
			}

			/// <summary>
			/// String's text.
			/// </summary>
			public string Text
			{
				get
				{
					return _strText;
				}
				set
				{
					_strText = value;
				}
			}
		}

		static private string _strLanguage = "";
		static readonly LanguageManager _objInstance = new LanguageManager();
		static private readonly Dictionary<string, string> _objDictionary = new Dictionary<string, string>();
		static bool _blnLoaded = false;
		static readonly XmlDocument _objXmlDocument = new XmlDocument();
		static XmlDocument _objXmlDataDocument;

		#region Constructor and Instance
		static LanguageManager()
		{
			RefreshStrings();
		}

		LanguageManager()
		{
		}

		/// <summary>
		/// Global instance of the LanguageManager.
		/// </summary>
		public static LanguageManager Instance
		{
			get
			{
				return _objInstance;
			}
		}
		#endregion

		#region Properties
		/// <summary>
		/// Whether or not the LanguageManager loaded the default language successfully.
		/// </summary>
		public bool Loaded
		{
			get
			{
				return _blnLoaded;
			}
		}

		/// <summary>
		/// XmlDocument that holds UI translations.
		/// </summary>
		public XmlDocument XmlDoc
		{
			get
			{
				return _objXmlDocument;
			}
		}

		/// <summary>
		/// XmlDocument that holds item name translations.
		/// </summary>
		public XmlDocument DataDoc
		{
			get
			{
				return _objXmlDataDocument;
			}
		}
		#endregion

		#region Methods
		/// <summary>
		/// Load the English document and cache it in the List of LanguageStrings so it only needs to be read in once.
		/// </summary>
		private static void RefreshStrings()
		{
			// The host is read outside the try block so that a missing host reaches the caller instead of the handler below.
			IApplicationHost objHost = ApplicationHost.Current;
			try
			{
				_objDictionary.Clear();
				XmlDocument objEnglishDocument = new XmlDocument();
				string strFilePath = Path.Combine(objHost.StartupPath, "lang");
				strFilePath = Path.Combine(strFilePath, "en-us.xml");
				objEnglishDocument.Load(strFilePath);
				foreach (XmlNode objNode in objEnglishDocument.SelectNodes("/chummer/strings/string"))
				{
					LanguageString objString = new LanguageString();
					objString.Key = objNode["key"].InnerText;
					objString.Text = objNode["text"].InnerText;
					_objDictionary.Add(objNode["key"].InnerText, objNode["text"].InnerText);
				}
				_blnLoaded = true;
			}
			catch
			{
				objHost.ShowError("Could not load default language file!", "Default Language Missing");
				objHost.Exit();
			}
		}

		/// <summary>
		/// Load the selected XML file and its associated custom file.
		/// </summary>
		/// <param name="strLanguage">Language to Load.</param>
		/// <param name="objObject">Object to translate after loading the data.</param>
		public void Load(string strLanguage, object objObject)
		{
			// _strLanguage is populated when the language is read for the first time, meaning this is only triggered once (and language is only read in once since it shouldn't change).
			string strFilePath = "";
			if (strLanguage != "en-us" && _strLanguage == "")
			{
				try
				{
					_strLanguage = strLanguage;
					XmlDocument objLanguageDocument = new XmlDocument();
					strFilePath = Path.Combine(ApplicationHost.Current.StartupPath, "lang");
					strFilePath = Path.Combine(strFilePath, strLanguage + ".xml");
					objLanguageDocument.Load(strFilePath);
					_objXmlDocument.Load(strFilePath);
					foreach (XmlNode objNode in objLanguageDocument.SelectNodes("/chummer/strings/string"))
					{
						// Look for the English version of the found string. If it has been found, replace the English contents with the contents from this file.
						// If the string was not found, then someone has inserted a Key that should not exist and is ignored.
						try
						{
							if (_objDictionary[objNode["key"].InnerText] != null)
								_objDictionary[objNode["key"].InnerText] = objNode["text"].InnerText;
						}
						catch
						{
						}
					}
				}
				catch (Exception)
				{
					_strLanguage = strLanguage;
					ApplicationHost.Current.ShowError("Language file " + strFilePath + " could not be loaded.", "Cannot Load Language");
					return;
				}

				// Check to see if the data translation file for the selected language exists.
				string strDataPath = Path.Combine(ApplicationHost.Current.StartupPath, "lang");
				strDataPath = Path.Combine(strDataPath, strLanguage + "_data.xml");
				if (File.Exists(strDataPath))
				{
					try
					{
						_objXmlDataDocument = new XmlDocument();
						_objXmlDataDocument.Load(strDataPath);
					}
					catch
					{
						// Failing to load the data translation file should not render the application unusable.
					}
				}
			}

			// Let the application translate the object if it is a Form or a UserControl.
			ApplicationHost.Current.TranslateControls(objObject);
		}

		/// <summary>
		/// Retrieve a string from the language file.
		/// </summary>
		/// <param name="strKey">Key to retrieve.</param>
		public string GetString(string strKey)
		{
			string strReturn = "";
			strReturn = _objDictionary[strKey].Replace("\\n", "\n");

			return strReturn;
		}

		/// <summary>
		/// Check the Keys in the selected language file against the English version. 
		/// </summary>
		/// <param name="strLanguage">Language to check.</param>
		public void VerifyStrings(string strLanguage)
		{
			// Load the English version.
			List<LanguageString> lstEnglish = new List<LanguageString>();
			XmlDocument objEnglishDocument = new XmlDocument();
			string strFilePath = Path.Combine(ApplicationHost.Current.StartupPath, "lang");
			strFilePath = Path.Combine(strFilePath, "en-us.xml");
			objEnglishDocument.Load(strFilePath);
			foreach (XmlNode objNode in objEnglishDocument.SelectNodes("/chummer/strings/string"))
			{
				LanguageString objString = new LanguageString();
				objString.Key = objNode["key"].InnerText;
				objString.Text = objNode["text"].InnerText;
				lstEnglish.Add(objString);
			}

			// Load the selected language version.
			List<LanguageString> lstLanguage = new List<LanguageString>();
			XmlDocument objLanguageDocument = new XmlDocument();
			string strLangPath = Path.Combine(ApplicationHost.Current.StartupPath, "lang");
			strLangPath = Path.Combine(strLangPath, strLanguage + ".xml");
			objLanguageDocument.Load(strLangPath);
			foreach (XmlNode objNode in objLanguageDocument.SelectNodes("/chummer/strings/string"))
			{
				LanguageString objString = new LanguageString();
				objString.Key = objNode["key"].InnerText;
				objString.Text = objNode["text"].InnerText;
				lstLanguage.Add(objString);
			}

			string strMessage = "";
			// Check for strings that are in the English file but not in the selected language file.
			foreach (LanguageString objString in lstEnglish)
			{
				LanguageString objFindString = lstLanguage.Find(objItem => objItem.Key == objString.Key);
				if (objFindString == null)
					strMessage += "\nMissing String: " + objString.Key;
			}
			// Check for strings that are not in the English file but are in the selected language file (someone has put in Keys that they shouldn't have which are ignored).
			foreach (LanguageString objString in lstLanguage)
			{
				LanguageString objFindString = lstEnglish.Find(objItem => objItem.Key == objString.Key);
				if (objFindString == null)
					strMessage += "\nUnused String: " + objString.Key;
			}

			// Display the message.
			if (strMessage != "")
				ApplicationHost.Current.ShowInformation(strMessage, "Language File Contents");
			else
				ApplicationHost.Current.ShowInformation("Language file is OK.", "Language File Contents");
		}

		/// <summary>
		/// Attempt to translate any Extra text for an item.
		/// </summary>
		/// <param name="strExtra">Extra string to translate.</param>
		public string TranslateExtra(string strExtra)
		{
			string strReturn = "";

			// Only attempt to translate if we're not using English. Don't attempt to translate an empty string either.
			if (_strLanguage != "en-us" && strExtra.Trim() != "")
			{
				XmlDocument objXmlDocument = new XmlDocument();

				// Look in Weapon Categories.
				objXmlDocument = XmlManager.Instance.Load("weapons.xml");
				XmlNode objNode = objXmlDocument.SelectSingleNode("/chummer/categories/category[. = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode.Attributes["translate"] != null)
					{
						strReturn = objNode.Attributes["translate"].InnerText;
						return strReturn;
					}
				}

				// Look in Weapons.
				objNode = objXmlDocument.SelectSingleNode("/chummer/weapons/weapon[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}

				// Look in Skills.
				objXmlDocument = XmlManager.Instance.Load("skills.xml");
				objNode = objXmlDocument.SelectSingleNode("/chummer/skills/skill[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}

				// Look in Skill Groups.
				objNode = objXmlDocument.SelectSingleNode("/chummer/skillgroups/name[. = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode.Attributes["translate"] != null)
					{
						strReturn = objNode.Attributes["translate"].InnerText;
						return strReturn;
					}
				}

				// Look in Mentors.
				objXmlDocument = XmlManager.Instance.Load("mentors.xml");
				objNode = objXmlDocument.SelectSingleNode("/chummer/mentors/mentor[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}
				objNode = objXmlDocument.SelectSingleNode("/chummer/mentors/mentor/choices/choice[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}

				// Look in Paragons.
				objXmlDocument = XmlManager.Instance.Load("paragons.xml");
				objNode = objXmlDocument.SelectSingleNode("/chummer/mentors/mentor[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}
				objNode = objXmlDocument.SelectSingleNode("/chummer/mentors/mentor/choices/choice[name = \"" + strExtra.Replace("\"", string.Empty) + "\"]");
				if (objNode != null)
				{
					if (objNode["translate"] != null)
					{
						strReturn = objNode["translate"].InnerText;
						return strReturn;
					}
				}

				// Attempt to translate Attribute names.
				switch (strExtra)
				{
					case "BOD":
						strReturn = GetString("String_AttributeBODShort");
						break;
					case "AGI":
						strReturn = GetString("String_AttributeAGIShort");
						break;
					case "REA":
						strReturn = GetString("String_AttributeREAShort");
						break;
					case "STR":
						strReturn = GetString("String_AttributeSTRShort");
						break;
					case "CHA":
						strReturn = GetString("String_AttributeCHAShort");
						break;
					case "INT":
						strReturn = GetString("String_AttributeINTShort");
						break;
					case "LOG":
						strReturn = GetString("String_AttributeLOGShort");
						break;
					case "WIL":
						strReturn = GetString("String_AttributeWILShort");
						break;
					case "EDG":
						strReturn = GetString("String_AttributeEDGShort");
						break;
					case "MAG":
						strReturn = GetString("String_AttributeMAGShort");
						break;
					case "RES":
						strReturn = GetString("String_AttributeRESShort");
						break;
				}
			}

			// If no translation could be found, just use whatever we were passed.
			if (strReturn == "")
				strReturn = strExtra;

			return strReturn;
		}
		#endregion
	}
}