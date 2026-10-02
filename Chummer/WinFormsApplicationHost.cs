using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// The application host of the Windows Forms app.
	/// </summary>
	public sealed class WinFormsApplicationHost : IApplicationHost
	{
		private readonly ControlTranslator _objTranslator = new ControlTranslator();
		private readonly WinFormsImprovementDialogs _objImprovementDialogs = new WinFormsImprovementDialogs();

		public string StartupPath
		{
			get
			{
				return Application.StartupPath;
			}
		}

		public void ShowError(string strText, string strCaption)
		{
			MessageBox.Show(strText, strCaption, MessageBoxButtons.OK, MessageBoxIcon.Error);
		}

		public void ShowInformation(string strText, string strCaption)
		{
			MessageBox.Show(strText, strCaption, MessageBoxButtons.OK, MessageBoxIcon.Information);
		}

		public bool AskYesNo(string strText, string strCaption)
		{
			return MessageBox.Show(strText, strCaption, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes;
		}

		public void Exit()
		{
			Application.Exit();
		}

		public void TranslateControls(object objObject)
		{
			_objTranslator.Translate(objObject);
		}

		public IImprovementDialogs ImprovementDialogs
		{
			get
			{
				return _objImprovementDialogs;
			}
		}
	}
}
