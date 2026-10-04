namespace Parity.Capture.Ui;

/// <summary>The window queries the active window depends on.</summary>
internal interface IWindowGraph
{
    bool IsEnabled(IntPtr window);

    /// <summary>The enabled pop-up window <paramref name="window"/> owns, or the window itself when it owns none.</summary>
    IntPtr EnabledPopup(IntPtr window);
}
