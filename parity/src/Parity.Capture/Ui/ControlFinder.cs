using System.Diagnostics;
using System.Windows.Automation;

namespace Parity.Capture.Ui;

/// <summary>Finds a control of a window by its WinForms name, which UI Automation reports as its automation ID.</summary>
internal sealed class ControlFinder
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    /// <summary>The first element named <paramref name="control"/> under the window that is on screen and enabled, waiting up to <see cref="Timeout"/>.</summary>
    public AutomationElement Find(Func<IntPtr> window, string control)
    {
        Condition condition = new PropertyCondition(AutomationElement.AutomationIdProperty, control);
        Stopwatch timer = Stopwatch.StartNew();
        IntPtr handle;
        do
        {
            handle = window();
            foreach (AutomationElement match in AutomationElement.FromHandle(handle).FindAll(TreeScope.Descendants, condition))
            {
                if (IsUsable(match))
                {
                    return match;
                }
            }

            Thread.Sleep(100);
        }
        while (timer.Elapsed < Timeout);

        throw new InvalidOperationException(
            $"No enabled control '{control}' is on screen in window '{Title(handle)}' after {Timeout.TotalSeconds:0} s.");
    }

    /// <summary>The window's title, for messages.</summary>
    public static string Title(IntPtr window)
    {
        try
        {
            return AutomationElement.FromHandle(window).Current.Name;
        }
        catch (ElementNotAvailableException)
        {
            return $"{window} (closed)";
        }
    }

    /// <summary>Names compare without the accelerator ampersands WinForms texts carry.</summary>
    public static string WithoutAccelerators(string text) => text.Replace("&&", "\u0001", StringComparison.Ordinal)
        .Replace("&", string.Empty, StringComparison.Ordinal)
        .Replace("\u0001", "&", StringComparison.Ordinal);

    private static bool IsUsable(AutomationElement element)
    {
        try
        {
            System.Windows.Rect bounds = element.Current.BoundingRectangle;
            return element.Current.IsEnabled && !element.Current.IsOffscreen && bounds.Width > 0 && bounds.Height > 0;
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
    }
}
