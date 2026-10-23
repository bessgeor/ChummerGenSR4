using System.Diagnostics;
using System.Windows.Automation;

namespace Parity.Capture.Ui;

/// <summary>Waits until a visible UI Automation element with an exact name exists under a window, which is looked up on every poll.</summary>
internal sealed class LabelWaiter
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(5);

    public void WaitForVisibleLabel(Func<IntPtr> window, string label)
    {
        Condition condition = new PropertyCondition(AutomationElement.NameProperty, label);
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < Timeout)
        {
            AutomationElementCollection matches = AutomationElement.FromHandle(window()).FindAll(TreeScope.Descendants, condition);
            foreach (AutomationElement match in matches)
            {
                if (IsVisible(match))
                {
                    return;
                }
            }

            Thread.Sleep(100);
        }

        throw new TimeoutException($"Timed out after {Timeout.TotalSeconds:0} s waiting for visible UI label '{label}'.");
    }

    /// <summary>A match can disappear while the tab rebuilds its controls; that match is simply not visible.</summary>
    private static bool IsVisible(AutomationElement element)
    {
        try
        {
            System.Windows.Rect bounds = element.Current.BoundingRectangle;
            return !element.Current.IsOffscreen && bounds.Width > 0 && bounds.Height > 0;
        }
        catch (ElementNotAvailableException)
        {
            return false;
        }
    }
}
