namespace Parity.Capture.Ui;

/// <summary>An app process that is asked to close its main window and exit.</summary>
internal interface IClosableApp
{
    void RequestClose();

    /// <summary>Whether the process has exited, waiting up to <paramref name="timeout"/>.</summary>
    bool WaitForExit(TimeSpan timeout);
}