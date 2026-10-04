using System.Globalization;
using Parity.Capture.Ui;
using Parity.Contracts.CaptureTiming;

namespace Parity.Capture.Timing;

/// <summary>Decorates a session: each call is measured by <see cref="TimedUiDriver"/> and passed to the real session.</summary>
internal sealed class TimedAppSession(IAppSession inner, TimedUiDriver driver) : IAppSession
{
    public void Activate() => driver.Measure(Operation.Activate, null, inner.Activate);

    public void SelectTab(string tabName) => driver.Measure(Operation.SelectTab, tabName, () => inner.SelectTab(tabName));

    public void WaitForLabel(string label) => driver.Measure(Operation.WaitForLabel, label, () => inner.WaitForLabel(label));

    public void Wait(int milliseconds) =>
        driver.Measure(Operation.Wait, milliseconds.ToString(CultureInfo.InvariantCulture), () => inner.Wait(milliseconds));

    public void SetValue(string control, string value) =>
        driver.Measure(Operation.SetValue, control, () => inner.SetValue(control, value));

    public void Click(string control) => driver.Measure(Operation.Click, control, () => inner.Click(control));

    public void SelectItem(string control, string item) =>
        driver.Measure(Operation.SelectItem, $"{control}={item}", () => inner.SelectItem(control, item));

    public void ContextMenu(string control, string item) =>
        driver.Measure(Operation.ContextMenu, $"{control}={item}", () => inner.ContextMenu(control, item));

    public Bitmap Capture() => driver.Measure(Operation.Capture, null, inner.Capture);

    public IReadOnlyList<Parity.Contracts.UiTree.UiNode> DescribeTree() => driver.Measure(Operation.UiTree, null, inner.DescribeTree);

    public void Dispose() => driver.Measure(Operation.Close, null, inner.Dispose);
}
