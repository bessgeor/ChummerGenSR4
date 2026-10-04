namespace Parity.Capture.Ui;

/// <summary>
/// The window that takes input: the main window while it is enabled, otherwise the topmost visible window it owns,
/// which is the modal dialog it shows, followed while that one is disabled by a dialog of its own.
/// </summary>
internal sealed class ActiveWindowResolver(IWindowGraph graph)
{
    /// <summary>The active window, or <see cref="IntPtr.Zero"/> while a disabled window owns no visible window, as before its dialog shows.</summary>
    public IntPtr Resolve(IntPtr mainWindow)
    {
        IntPtr window = mainWindow;
        HashSet<IntPtr> visited = [window];
        while (!graph.IsEnabled(window))
        {
            IntPtr owned = graph.OwnedWindows(window).FirstOrDefault();
            if (owned == IntPtr.Zero || !visited.Add(owned))
            {
                return IntPtr.Zero;
            }

            window = owned;
        }

        return window;
    }
}
