using System;
using System.Collections.Generic;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// The selections of improvements, asked with the app's selection windows. A forced value is taken by a window with opacity 0.
	/// </summary>
	public sealed class WinFormsImprovementDialogs : IImprovementDialogs
	{
		public string SelectText(string strFriendlyName, string strForcedValue)
		{
			frmSelectText frmPickText = new frmSelectText();
			frmPickText.Description = LanguageManager.Instance.GetString("String_Improvement_SelectText").Replace("{0}", strFriendlyName);

			if (strForcedValue != "")
			{
				frmPickText.SelectedValue = strForcedValue;
				frmPickText.Opacity = 0;
			}

			frmPickText.ShowDialog();

			if (frmPickText.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickText.SelectedValue;
		}

		public string SelectRestrictedItem(IImprovementCharacter objCharacter, string strForcedValue)
		{
			frmSelectItem frmPickItem = new frmSelectItem();
			frmPickItem.Character = AppCharacter(objCharacter);
			if (strForcedValue != string.Empty)
				frmPickItem.ForceItem = strForcedValue;
			frmPickItem.AllowAutoSelect = false;
			frmPickItem.ShowDialog();

			if (frmPickItem.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickItem.SelectedItem;
		}

		public string SelectSkill(IImprovementCharacter objCharacter, string strFriendlyName, string strOnlySkillGroup, string strOnlyCategory, string strExcludeCategory, string strLimitToSkill, string strForcedValue)
		{
			frmSelectSkill frmPickSkill = new frmSelectSkill(AppCharacter(objCharacter));
			if (strFriendlyName != "")
				frmPickSkill.Description = LanguageManager.Instance.GetString("String_Improvement_SelectSkillNamed").Replace("{0}", strFriendlyName);
			else
				frmPickSkill.Description = LanguageManager.Instance.GetString("String_Improvement_SelectSkill");

			if (strOnlySkillGroup != null)
				frmPickSkill.OnlySkillGroup = strOnlySkillGroup;
			else if (strOnlyCategory != null)
				frmPickSkill.OnlyCategory = strOnlyCategory;
			else if (strExcludeCategory != null)
				frmPickSkill.ExcludeCategory = strExcludeCategory;
			else if (strLimitToSkill != null)
				frmPickSkill.LimitToSkill = strLimitToSkill;
			if (strForcedValue != "")
			{
				frmPickSkill.OnlySkill = strForcedValue;
				frmPickSkill.Opacity = 0;
			}
			frmPickSkill.ShowDialog();

			if (frmPickSkill.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickSkill.SelectedSkill;
		}

		public string SelectSkillGroup(string strFriendlyName, string strForcedValue, string strExcludeCategory)
		{
			frmSelectSkillGroup frmPickSkillGroup = new frmSelectSkillGroup();
			if (strFriendlyName != "")
				frmPickSkillGroup.Description = LanguageManager.Instance.GetString("String_Improvement_SelectSkillGroupName").Replace("{0}", strFriendlyName);
			else
				frmPickSkillGroup.Description = LanguageManager.Instance.GetString("String_Improvement_SelectSkillGroup");

			if (strForcedValue != "")
			{
				frmPickSkillGroup.OnlyGroup = strForcedValue;
				frmPickSkillGroup.Opacity = 0;
			}

			if (strExcludeCategory != string.Empty)
				frmPickSkillGroup.ExcludeCategory = strExcludeCategory;

			frmPickSkillGroup.ShowDialog();

			if (frmPickSkillGroup.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickSkillGroup.SelectedSkillGroup;
		}

		public string SelectAttribute(string strFriendlyName, bool blnAddMAG, bool blnAddRES, List<string> lstLimitTo, List<string> lstRemove, string strForcedValue)
		{
			frmSelectAttribute frmPickAttribute = new frmSelectAttribute();
			if (strFriendlyName != "")
				frmPickAttribute.Description = LanguageManager.Instance.GetString("String_Improvement_SelectAttributeNamed").Replace("{0}", strFriendlyName);
			else
				frmPickAttribute.Description = LanguageManager.Instance.GetString("String_Improvement_SelectAttribute");

			if (blnAddMAG)
				frmPickAttribute.AddMAG();
			if (blnAddRES)
				frmPickAttribute.AddRES();

			if (lstLimitTo != null)
				frmPickAttribute.LimitToList(lstLimitTo);

			if (lstRemove != null)
				frmPickAttribute.RemoveFromList(lstRemove);

			if (strForcedValue != "")
			{
				frmPickAttribute.SingleAttribute(strForcedValue);
				frmPickAttribute.Opacity = 0;
			}

			frmPickAttribute.ShowDialog();

			if (frmPickAttribute.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickAttribute.SelectedAttribute;
		}

		public string SelectSwapSkillAttribute(string strFriendlyName, List<string> lstRemove, List<string> lstLimitTo, string strForcedValue)
		{
			frmSelectAttribute frmPickAttribute = new frmSelectAttribute();
			if (strFriendlyName != "")
				frmPickAttribute.Description = LanguageManager.Instance.GetString("String_Improvement_SelectAttributeNamed").Replace("{0}", strFriendlyName);
			else
				frmPickAttribute.Description = LanguageManager.Instance.GetString("String_Improvement_SelectAttribute");

			frmPickAttribute.RemoveFromList(lstRemove);

			if (lstLimitTo != null)
				frmPickAttribute.LimitToList(lstLimitTo);

			if (strForcedValue != "")
			{
				frmPickAttribute.SingleAttribute(strForcedValue);
				frmPickAttribute.Opacity = 0;
			}

			frmPickAttribute.ShowDialog();

			if (frmPickAttribute.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickAttribute.SelectedAttribute;
		}

		public string SelectSpell(IImprovementCharacter objCharacter, string strLimitCategory, string strForcedValue)
		{
			frmSelectSpell frmPickSpell = new frmSelectSpell(AppCharacter(objCharacter));

			if (strLimitCategory != null)
				frmPickSpell.LimitCategory = strLimitCategory;
			if (strForcedValue != "")
			{
				frmPickSpell.ForceSpellName = strForcedValue;
				frmPickSpell.Opacity = 0;
			}

			frmPickSpell.ShowDialog();

			if (frmPickSpell.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickSpell.SelectedSpell;
		}

		public MentorSpiritSelection SelectMentorSpirit(IImprovementCharacter objCharacter, string strXmlFile)
		{
			frmSelectMentorSpirit frmPickMentorSpirit = new frmSelectMentorSpirit(AppCharacter(objCharacter));
			if (strXmlFile != null)
				frmPickMentorSpirit.XmlFile = strXmlFile;
			frmPickMentorSpirit.ShowDialog();

			if (frmPickMentorSpirit.DialogResult == DialogResult.Cancel)
				return null;

			MentorSpiritSelection objSelection = new MentorSpiritSelection();
			objSelection.SelectedMentor = frmPickMentorSpirit.SelectedMentor;
			objSelection.BonusNode = frmPickMentorSpirit.BonusNode;
			objSelection.Choice1 = frmPickMentorSpirit.Choice1;
			objSelection.Choice1BonusNode = frmPickMentorSpirit.Choice1BonusNode;
			objSelection.Choice2 = frmPickMentorSpirit.Choice2;
			objSelection.Choice2BonusNode = frmPickMentorSpirit.Choice2BonusNode;
			return objSelection;
		}

		public string SelectSide(string strFriendlyName, string strForcedValue)
		{
			frmSelectSide frmPickSide = new frmSelectSide();
			frmPickSide.Description = LanguageManager.Instance.GetString("Label_SelectSide").Replace("{0}", strFriendlyName);
			if (strForcedValue != "")
				frmPickSide.ForceValue(strForcedValue);
			else
				frmPickSide.ShowDialog();

			// The result is checked whether or not the window was shown.
			if (frmPickSide.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickSide.SelectedSide;
		}

		public string SelectSprite(List<ListItem> lstSprites)
		{
			frmSelectItem frmPickItem = new frmSelectItem();
			frmPickItem.GeneralItems = lstSprites;
			frmPickItem.ShowDialog();

			if (frmPickItem.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickItem.SelectedItem;
		}

		public string SelectWeapon(string strFriendlyName, List<ListItem> lstWeapons, string strForcedValue)
		{
			frmSelectItem frmPickItem = new frmSelectItem();
			frmPickItem.Description = LanguageManager.Instance.GetString("String_Improvement_SelectText").Replace("{0}", strFriendlyName);
			frmPickItem.GeneralItems = lstWeapons;

			if (strForcedValue != "")
			{
				frmPickItem.ForceItem = strForcedValue;
				frmPickItem.Opacity = 0;
			}

			frmPickItem.ShowDialog();

			if (frmPickItem.DialogResult == DialogResult.Cancel)
				return null;
			return frmPickItem.SelectedItem;
		}

		/// <summary>
		/// The app's character behind the interface, which the selection windows need.
		/// </summary>
		private static Character AppCharacter(IImprovementCharacter objCharacter)
		{
			Character objAppCharacter = objCharacter as Character;
			if (objAppCharacter == null)
				throw new ArgumentException("The selection windows need the app's Character, not " + (objCharacter == null ? "null" : objCharacter.GetType().FullName) + ".", "objCharacter");
			return objAppCharacter;
		}
	}
}
