using System.Diagnostics;

namespace Parity.Capture.Ui;

/// <summary>Starts the app with the character path as its only argument, from the executable's own folder.</summary>
internal sealed class ChummerUiDriver(
    WindowFinder finder,
    WindowActivator activator,
    WindowGeometry geometry,
    TabNavigator tabs,
    LabelWaiter labels,
    WindowCapturer capturer,
    PointerParker pointer,
    UiTreeReader trees) : IUiDriver
{
    public IAppSession Launch(string executablePath, string characterPath, UiTiming timing)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = executablePath,
            WorkingDirectory = Path.GetDirectoryName(executablePath)!,
            UseShellExecute = false,
        };
        startInfo.ArgumentList.Add(characterPath);
        Process process = Process.Start(startInfo)
                          ?? throw new InvalidOperationException($"Could not start {executablePath}.");
        ChummerSession session = new(process, timing, finder, activator, geometry, tabs, labels, capturer, pointer, trees);
        try
        {
            session.WaitUntilReady();
            return session;
        }
        catch
        {
            session.Dispose();
            throw;
        }
    }
}
