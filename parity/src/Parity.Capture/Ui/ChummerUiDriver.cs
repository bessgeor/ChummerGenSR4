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
    UiTreeReader trees,
    ActiveWindowResolver activeWindows,
    ControlActions controls,
    SaveReloader reloader,
    MessageRoundTrip roundTrip,
    Func<DialogSafeCaller> newCaller) : IUiDriver
{
    public IAppSession Launch(string executablePath, string characterPath, UiTiming timing)
    {
        Process process = Start(executablePath, characterPath);
        ChummerSession session = new(
            process,
            () => Start(executablePath, characterPath),
            characterPath,
            timing,
            finder,
            activator,
            geometry,
            tabs,
            labels,
            capturer,
            pointer,
            trees,
            activeWindows,
            controls,
            reloader,
            roundTrip,
            newCaller());
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

    private static Process Start(string executablePath, string characterPath)
    {
        ProcessStartInfo startInfo = new()
        {
            FileName = executablePath,
            WorkingDirectory = Path.GetDirectoryName(executablePath)!,
            UseShellExecute = false,
        };
        startInfo.ArgumentList.Add(characterPath);
        return Process.Start(startInfo) ?? throw new InvalidOperationException($"Could not start {executablePath}.");
    }
}
