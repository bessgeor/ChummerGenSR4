using System.Diagnostics;
using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>The edit box of a control through its UI Automation value pattern; the keyboard leaves it.</summary>
internal sealed class UiaValueBox(
    AutomationElement control,
    AutomationElement edit,
    ValuePattern pattern,
    KeyboardInput keyboard,
    string name) : IValueBox
{
    public string Value => pattern.Current.Value;

    public void Focus() => control.SetFocus();

    public void Set(string value) => pattern.SetValue(value);

    public void LeaveWithTab()
    {
        keyboard.Press(NativeMethods.VkTab);
        Stopwatch timer = Stopwatch.StartNew();
        while (edit.Current.HasKeyboardFocus)
        {
            if (timer.Elapsed >= ControlFinder.Timeout)
            {
                throw new TimeoutException($"'{name}' still has the keyboard focus {ControlFinder.Timeout.TotalSeconds:0} s after Tab.");
            }

            Thread.Sleep(50);
        }
    }
}