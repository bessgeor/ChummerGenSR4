using System;
using System.Linq;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// Translates the controls of Forms and UserControls with the strings of the LanguageManager.
	/// </summary>
	public sealed class ControlTranslator
	{
		static private readonly bool _blnDebug = false;

		static ControlTranslator()
		{
			string[] strArgs = Environment.GetCommandLineArgs();
			if (strArgs.GetUpperBound(0) > 0)
			{
				if (strArgs[1] == "/debug")
					_blnDebug = true;
			}
		}

		/// <summary>
		/// Translate a Form or UserControl. Any other object is left alone.
		/// </summary>
		/// <param name="objObject">Object to translate.</param>
		public void Translate(object objObject)
		{
			// If the object is a Form, call the UpdateForm method to provide its translations.
			if (objObject is Form)
				UpdateForm((Form)objObject);

			// If the object is a UserControl, call the UpdateUserControl method to provide its translations.
			if (objObject is UserControl)
				UpdateUserControl((UserControl)objObject);
		}

		/// <summary>
		/// Retrieve a string from the language file.
		/// </summary>
		/// <param name="strKey">Key to retrieve.</param>
		private static string GetString(string strKey)
		{
			return LanguageManager.Instance.GetString(strKey);
		}

		/// <summary>
		/// Recursive method to translate all of the controls in a Form or UserControl.
		/// </summary>
		/// <param name="objParent">Control container to translate.</param>
		private void UpdateControls(Control objParent)
		{
			// Translatable items are identified by having a value in their Tag attribute. The contents of Tag is the string to lookup in the language list.

			foreach (Label lblLabel in objParent.Controls.OfType<Label>())
			{
				if (lblLabel.Tag != null)
				{
					try
					{
						lblLabel.Text = GetString(lblLabel.Tag.ToString());
					}
					catch
					{
						if (_blnDebug)
							throw;
						else
							lblLabel.Text = lblLabel.Tag.ToString();
					}
				}
			}
			foreach (Button cmdButton in objParent.Controls.OfType<Button>())
			{
				if (cmdButton.Tag != null)
				{
					try
					{
						cmdButton.Text = GetString(cmdButton.Tag.ToString());
					}
					catch
					{
						if (_blnDebug)
							throw;
						else
							cmdButton.Text = cmdButton.Tag.ToString();
					}
				}
			}
			foreach (CheckBox chkCheckbox in objParent.Controls.OfType<CheckBox>())
			{
				if (chkCheckbox.Tag != null)
				{
					try
					{
						if (chkCheckbox.Tag.ToString().Contains("_"))
							chkCheckbox.Text = GetString(chkCheckbox.Tag.ToString());
					}
					catch
					{
						if (_blnDebug)
							throw;
						else
							chkCheckbox.Text = chkCheckbox.Tag.ToString();
					}
				}
			}
			foreach (ListView lstList in objParent.Controls.OfType<ListView>())
			{
				foreach (ColumnHeader objHeader in lstList.Columns)
				{
					if (objHeader.Tag != null)
					{
						try
						{
							objHeader.Text = GetString(objHeader.Tag.ToString());
						}
						catch
						{
							if (_blnDebug)
								throw;
							else
								objHeader.Text = objHeader.Tag.ToString();
						}
					}
				}
			}

			// Run through any Panels on the container.
			foreach (Panel objPanel in objParent.Controls.OfType<Panel>())
			{
				UpdateControls(objPanel);
			}

			// Run through any Tabs on the container.
			foreach (TabControl objTabControl in objParent.Controls.OfType<TabControl>())
			{
				foreach (TabPage tabPage in objTabControl.TabPages)
				{
					if (tabPage.Tag != null)
					{
						try
						{
							tabPage.Text = GetString(tabPage.Tag.ToString());
						}
						catch
						{
							if (_blnDebug)
								throw;
							else
								tabPage.Text = tabPage.Tag.ToString();
						}
					}

					UpdateControls(tabPage);
				}
			}

			// Run through everything in any SplitContainers.
			foreach (SplitContainer objSplitControl in objParent.Controls.OfType<SplitContainer>())
			{
				for (int i = 1; i <= 2; i++)
				{
					SplitterPanel objSplitPanel;
					if (i == 1)
						objSplitPanel = objSplitControl.Panel1;
					else
						objSplitPanel = objSplitControl.Panel2;

					UpdateControls(objSplitPanel);
				}
			}

			// Run through any FlowLayoutPanels on the container.
			foreach (FlowLayoutPanel objContainer in objParent.Controls.OfType<FlowLayoutPanel>())
			{
				UpdateControls(objContainer);
			}

			foreach (TreeView treTree in objParent.Controls.OfType<TreeView>())
			{
				foreach (TreeNode objNode in treTree.Nodes)
				{
					if (objNode.Level == 0)
					{
						if (objNode.Tag != null)
						{
							if (objNode.Tag.ToString().StartsWith("Node_"))
							{
								try
								{
									objNode.Text = GetString(objNode.Tag.ToString());
								}
								catch
								{
									if (_blnDebug)
										throw;
									else
										objNode.Text = objNode.Tag.ToString();
								}
							}
						}
					}
				}
			}
		}

		/// <summary>
		/// Translate the contents of a UserControl.
		/// </summary>
		/// <param name="objControl">UserControl to translate.</param>
		private void UpdateUserControl(UserControl objControl)
		{
			UpdateControls(objControl);
		}

		/// <summary>
		/// Translate the contents of a Form.
		/// </summary>
		/// <param name="objForm">Form to translate.</param>
		private void UpdateForm(Form objForm)
		{
			// Translatable items are identified by having a value in their Tag attribute. The contents of Tag is the string to lookup in the language list.
			// Update the Form itself.
			if (objForm.Tag != null)
			{
				try
				{
					objForm.Text = GetString(objForm.Tag.ToString());
				}
				catch
				{
					if (_blnDebug)
						throw;
					else
						objForm.Text = objForm.Tag.ToString();
				}
			}

			// Run through any StatusStrips.
			foreach (StatusStrip objStrip in objForm.Controls.OfType<StatusStrip>())
			{
				foreach (ToolStripStatusLabel tssLabel in objStrip.Items.OfType<ToolStripStatusLabel>())
				{
					if (tssLabel.Tag != null)
						try
						{
							tssLabel.Text = GetString(tssLabel.Tag.ToString());
						}
						catch
						{
							if (_blnDebug)
								throw;
							else
								tssLabel.Text = tssLabel.Tag.ToString();
						}
				}
			}

			// Handle control over to the method that handles translating all of the other Controls.
			UpdateControls(objForm);
		}

	}
}
