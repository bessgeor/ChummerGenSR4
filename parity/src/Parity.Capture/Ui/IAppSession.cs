namespace Parity.Capture.Ui;

/// <summary>A running app with one character open, driven one action at a time.</summary>
internal interface IAppSession : IDisposable
{
    /// <summary>Brings the app's main window to the foreground; throws <see cref="WindowActivationException"/>.</summary>
    void Activate();

    /// <summary>Selects a tab and waits until it is selected; throws <see cref="TabNotFoundException"/> if no tab has the name.</summary>
    void SelectTab(string tabName);

    void WaitForLabel(string label);

    void Wait(int milliseconds);

    Bitmap Capture();
}
