using System.Windows.Automation;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>A context menu through its UI Automation menu items; Escape closes it.</summary>
internal sealed class UiaContextMenu : IContextMenu
{
    private readonly KeyboardInput _keyboard;

    public UiaContextMenu(AutomationElement menu, KeyboardInput keyboard)
    {
        _keyboard = keyboard;
        Entries = menu.FindAll(
                TreeScope.Descendants,
                new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.MenuItem))
            .Cast<AutomationElement>()
            .Select(Entry)
            .ToList();
    }

    public IReadOnlyList<MenuEntry> Entries { get; }

    public void Close() => _keyboard.Press(NativeMethods.VkEscape);

    private static MenuEntry Entry(AutomationElement item)
    {
        string name = ControlFinder.WithoutAccelerators(item.Current.Name);
        return new MenuEntry(name, item.TryGetCurrentPattern(InvokePattern.Pattern, out object? invoke) ? ((InvokePattern)invoke).Invoke : null);
    }
}