namespace Parity.Capture.Ui;

/// <summary>Launches an app on a character and returns a session once its main window is ready.</summary>
internal interface IUiDriver
{
    IAppSession Launch(string executablePath, string characterPath, UiTiming timing);
}
