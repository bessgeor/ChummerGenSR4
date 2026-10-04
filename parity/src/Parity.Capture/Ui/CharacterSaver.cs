using System.Diagnostics;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// Saves the open character with the character form's own Save command, Ctrl+S, and waits until the app has
/// rewritten its file: the file's write time is set back first, so a write the app makes shows as a newer one.
/// </summary>
internal sealed class CharacterSaver(WindowCapturer capturer, KeyboardInput keyboard)
{
    public static readonly TimeSpan WriteTimeout = TimeSpan.FromSeconds(10);
    private static readonly DateTime Marker = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public void Save(IntPtr mainWindow, string characterPath, Action waitUntilIdle)
    {
        File.SetLastWriteTimeUtc(characterPath, Marker);
        capturer.FocusStatusBar(mainWindow);
        keyboard.Press(NativeMethods.VkControl, NativeMethods.VkS);
        Stopwatch timer = Stopwatch.StartNew();
        while (File.GetLastWriteTimeUtc(characterPath) == Marker)
        {
            if (timer.Elapsed >= WriteTimeout)
            {
                throw new TimeoutException(
                    $"The app did not write {Path.GetFileName(characterPath)} within {WriteTimeout.TotalSeconds:0} s after Ctrl+S.");
            }

            Thread.Sleep(100);
        }

        // The app saves on its UI thread, so it is idle again only once the file is written.
        waitUntilIdle();
        WaitUntilClosed(characterPath, timer);
    }

    /// <summary>Waits until no process holds the file open, so the next process reads the whole of it.</summary>
    private static void WaitUntilClosed(string characterPath, Stopwatch timer)
    {
        while (true)
        {
            try
            {
                using FileStream stream = new(characterPath, FileMode.Open, FileAccess.Read, FileShare.None);
                return;
            }
            catch (IOException) when (timer.Elapsed < WriteTimeout)
            {
                Thread.Sleep(100);
            }
        }
    }
}
