namespace Parity.Capture.Ui;

/// <summary>
/// What a save and close acts on: the character form, the window that takes input, the character file, what waits
/// until the app handles a message and what names the window that takes input, as it is then, for a message.
/// </summary>
internal sealed record SaveTarget(IntPtr MainWindow, IntPtr ActiveWindow, string CharacterPath, Action WaitUntilHandled, Func<string> DescribeActive);