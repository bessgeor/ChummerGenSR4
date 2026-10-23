using Parity.Contracts.CaptureSummary;

namespace Parity.Capture.Run;

/// <summary>The screens at run time; captures depend on their resolution and working area.</summary>
internal sealed class ScreenInventory
{
    public IReadOnlyList<ScreenInfo> Current() =>
        Screen.AllScreens.Select(screen => new ScreenInfo
        {
            DeviceName = screen.DeviceName,
            Primary = screen.Primary,
            Bounds = Rect(screen.Bounds),
            WorkingArea = Rect(screen.WorkingArea),
        }).ToList();

    private static ScreenRect Rect(Rectangle rectangle) => new()
    {
        X = rectangle.X,
        Y = rectangle.Y,
        Width = rectangle.Width,
        Height = rectangle.Height,
    };
}
