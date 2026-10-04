namespace Parity.Capture.Ui;

/// <summary>Saves the character from the character form and closes the app, which must exit by itself.</summary>
internal sealed class SaveReloader(CharacterSaver saver, SaveTimeouts timeouts)
{
    /// <summary>Fails when a dialog is open, when nothing is written or when the app does not exit within the time.</summary>
    public void SaveAndClose(SaveTarget target, IClosableApp app)
    {
        if (target.ActiveWindow != target.MainWindow)
        {
            throw new InvalidOperationException(
                $"The dialog '{target.DescribeActive()}' is open; the character is saved from the character form.");
        }

        saver.Save(target.MainWindow, target.CharacterPath, target.WaitUntilHandled);
        app.RequestClose();
        if (!app.WaitForExit(timeouts.Exit))
        {
            throw new InvalidOperationException(
                $"The app did not exit within {timeouts.Exit.TotalSeconds:0} s after saving; its active window is '{target.DescribeActive()}'.");
        }
    }
}