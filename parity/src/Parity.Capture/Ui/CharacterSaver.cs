using System.Diagnostics;

namespace Parity.Capture.Ui;

/// <summary>
/// Saves the open character with the character form's own Save command and waits until the app has rewritten its
/// file: the file's write time is set back first, so a write the app makes shows as a newer one.
/// </summary>
internal sealed class CharacterSaver(ISaveCommand command, SaveTimeouts timeouts)
{
    private static readonly DateTime Marker = new(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc);

    public void Save(IntPtr mainWindow, string characterPath, Action waitUntilHandled)
    {
        File.SetLastWriteTimeUtc(characterPath, Marker);
        command.Send(mainWindow);
        Stopwatch timer = Stopwatch.StartNew();
        while (File.GetLastWriteTimeUtc(characterPath) == Marker)
        {
            if (timer.Elapsed >= timeouts.Write)
            {
                throw new TimeoutException(
                    $"The app did not write {Path.GetFileName(characterPath)} within {timeouts.Write.TotalSeconds:0} s after the save command.");
            }

            Thread.Sleep(50);
        }

        // The app saves on its UI thread, so it handles a message again only once the file is written.
        waitUntilHandled();
        WaitUntilClosed(characterPath);
    }

    /// <summary>Waits, for a time of its own, until no process holds the file open, so the next process reads the whole of it.</summary>
    private void WaitUntilClosed(string characterPath)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (true)
        {
            try
            {
                using FileStream stream = new(characterPath, FileMode.Open, FileAccess.Read, FileShare.None);
                return;
            }
            catch (IOException exception)
            {
                if (timer.Elapsed >= timeouts.Close)
                {
                    throw new IOException(
                        $"{Path.GetFileName(characterPath)} was still held open {timeouts.Close.TotalSeconds:0} s after the app wrote it: {exception.Message}",
                        exception);
                }

                Thread.Sleep(50);
            }
        }
    }
}