namespace Parity.Capture.Ui;

/// <summary>The window queries the active window depends on.</summary>
internal interface IWindowGraph
{
    bool IsEnabled(IntPtr window);

    /// <summary>The visible windows <paramref name="owner"/> owns directly, topmost first, without tooltips.</summary>
    IReadOnlyList<IntPtr> OwnedWindows(IntPtr owner);
}
