using System.Windows.Automation;
using Parity.Contracts.UiTree;

namespace Parity.Capture.Ui;

/// <summary>
/// Reads the UI Automation tree of a window as it is on screen: the control view's elements that are not off
/// screen, fetched in one cached request and flattened depth first with each node's parent index.
/// </summary>
internal sealed class UiTreeReader
{
    public IReadOnlyList<UiNode> Read(IntPtr window)
    {
        CacheRequest request = new()
        {
            TreeScope = TreeScope.Subtree,
            TreeFilter = new AndCondition(Automation.ControlViewCondition, new PropertyCondition(AutomationElement.IsOffscreenProperty, false)),
            AutomationElementMode = AutomationElementMode.None,
        };
        request.Add(AutomationElement.AutomationIdProperty);
        request.Add(AutomationElement.NameProperty);
        request.Add(AutomationElement.ControlTypeProperty);
        request.Add(AutomationElement.ClassNameProperty);
        request.Add(AutomationElement.IsEnabledProperty);
        request.Add(AutomationElement.BoundingRectangleProperty);

        AutomationElement root = AutomationElement.FromHandle(window).GetUpdatedCache(request);
        List<UiNode> nodes = [];
        Add(root, null, nodes);
        return nodes;
    }

    private static void Add(AutomationElement element, int? parent, List<UiNode> nodes)
    {
        AutomationElement.AutomationElementInformation cached = element.Cached;
        int index = nodes.Count;
        nodes.Add(new UiNode
        {
            Parent = parent,
            AutomationId = cached.AutomationId ?? string.Empty,
            Name = cached.Name ?? string.Empty,
            ControlType = cached.ControlType.ProgrammaticName,
            ClassName = cached.ClassName ?? string.Empty,
            Enabled = cached.IsEnabled,
            Bounds = Bounds(cached.BoundingRectangle),
        });
        foreach (AutomationElement child in element.CachedChildren)
        {
            Add(child, index, nodes);
        }
    }

    /// <summary>An element without a rectangle reports an empty one, whose sides are infinite; it gets zero bounds.</summary>
    private static UiBounds Bounds(System.Windows.Rect rect) => rect.IsEmpty
        ? new UiBounds { X = 0, Y = 0, Width = 0, Height = 0 }
        : new UiBounds
        {
            X = (long)Math.Round(rect.X),
            Y = (long)Math.Round(rect.Y),
            Width = (long)Math.Round(rect.Width),
            Height = (long)Math.Round(rect.Height),
        };
}
