namespace Parity.Capture.Ui;

/// <summary>Gives the character form its Save command.</summary>
internal interface ISaveCommand
{
    void Send(IntPtr mainWindow);
}