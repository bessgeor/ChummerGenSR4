namespace Chummer
{
	/// <summary>
	/// What the classes of this library need from the application that runs them.
	/// </summary>
	public interface IApplicationHost
	{
		/// <summary>
		/// Folder of the application's executable, which holds the data, language and settings folders.
		/// </summary>
		string StartupPath { get; }

		/// <summary>
		/// Show an error message and wait until the user closes it.
		/// </summary>
		/// <param name="strText">Message to show.</param>
		/// <param name="strCaption">Caption of the message.</param>
		void ShowError(string strText, string strCaption);

		/// <summary>
		/// Show an information message and wait until the user closes it.
		/// </summary>
		/// <param name="strText">Message to show.</param>
		/// <param name="strCaption">Caption of the message.</param>
		void ShowInformation(string strText, string strCaption);

		/// <summary>
		/// Ask the user a question that is answered with yes or no.
		/// </summary>
		/// <param name="strText">Question to ask.</param>
		/// <param name="strCaption">Caption of the question.</param>
		/// <returns>Whether or not the user answered yes.</returns>
		bool AskYesNo(string strText, string strCaption);

		/// <summary>
		/// Close the application.
		/// </summary>
		void Exit();

		/// <summary>
		/// Translate the controls of a form or user control with the loaded language. Any other object is left alone.
		/// </summary>
		/// <param name="objObject">Object to translate.</param>
		void TranslateControls(object objObject);

		/// <summary>
		/// The dialogs that ask the user for the selections of improvement bonuses.
		/// </summary>
		IImprovementDialogs ImprovementDialogs { get; }
	}
}
