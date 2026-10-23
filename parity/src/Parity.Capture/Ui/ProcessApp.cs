using System.Diagnostics;

namespace Parity.Capture.Ui;

/// <summary>A process that closes its main window and exits.</summary>
internal sealed class ProcessApp(Process process) : IClosableApp
{
    public void RequestClose() => process.CloseMainWindow();

    public bool WaitForExit(TimeSpan timeout) => process.WaitForExit(timeout);
}