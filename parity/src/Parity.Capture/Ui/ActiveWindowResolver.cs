namespace Parity.Capture.Ui;

/// <summary>
/// The window that takes input: the main window while it is enabled, otherwise the enabled pop-up window it owns,
/// which is the modal dialog it shows, followed while that one is disabled by a dialog of its own.
/// </summary>
internal sealed class ActiveWindowResolver(IWindowGraph graph)
{
    /// <summary>The active window, or <see cref="IntPtr.Zero"/> when a disabled window owns no enabled pop-up.</summary>
    public IntPtr Resolve(IntPtr mainWindow)
    {
        IntPtr window = mainWindow;
        HashSet<IntPtr> visited = [window];
        while (!graph.IsEnabled(window))
        {
            IntPtr popup = graph.EnabledPopup(window);
            if (popup == IntPtr.Zero || !visited.Add(popup))
            {
                return IntPtr.Zero;
            }

            window = popup;
        }

        return window;
    }
}
