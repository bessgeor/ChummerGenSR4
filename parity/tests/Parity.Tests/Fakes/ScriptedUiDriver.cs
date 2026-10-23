using Parity.Capture.Ui;
using Parity.Contracts.UiTree;

namespace Parity.Tests.Fakes;

/// <summary>A UI driver whose app has a fixed set of tabs and labels and scripted failures.</summary>
internal sealed class ScriptedUiDriver : IUiDriver
{
    public HashSet<string> Tabs { get; } = new(StringComparer.Ordinal);

    public HashSet<string> MissingLabels { get; } = new(StringComparer.Ordinal);

    /// <summary>Controls every acting call on fails to find.</summary>
    public HashSet<string> MissingControls { get; } = new(StringComparer.Ordinal);

    public Exception? LaunchFailure { get; set; }

    public int ActivationFailuresBeforeCapture { get; set; } = -1;

    public bool PointerMovedBeforeCapture { get; set; }

    public Color CaptureColor { get; set; } = Color.White;

    /// <summary>Thrown by every tree request when set.</summary>
    public Exception? TreeFailure { get; set; }

    public List<string> Calls { get; } = [];

    public bool Disposed { get; private set; }

    public IAppSession Launch(string executablePath, string characterPath, UiTiming timing)
    {
        Calls.Add($"launch:{Path.GetFileName(executablePath)}");
        if (LaunchFailure is not null)
        {
            throw LaunchFailure;
        }

        return new Session(this);
    }

    private sealed class Session(ScriptedUiDriver owner) : IAppSession
    {
        private bool _nextIsCapture;

        public void Activate()
        {
            if (_nextIsCapture && owner.ActivationFailuresBeforeCapture == 0)
            {
                throw new WindowActivationException("scripted foreground loss");
            }
        }

        public void SelectTab(string tabName)
        {
            owner.Calls.Add($"selectTab:{tabName}");
            if (!owner.Tabs.Contains(tabName))
            {
                throw new TabNotFoundException($"No tab named '{tabName}'.");
            }
        }

        public void WaitForLabel(string label)
        {
            owner.Calls.Add($"waitFor:{label}");
            if (owner.MissingLabels.Contains(label))
            {
                throw new TimeoutException($"Timed out waiting for visible UI label '{label}'.");
            }

            _nextIsCapture = true;
        }

        public void Wait(int milliseconds) => owner.Calls.Add($"wait:{milliseconds}");

        public void SetValue(string control, string value) => Act($"setValue:{control}={value}", control);

        public void Click(string control) => Act($"click:{control}", control);

        public void SelectItem(string control, string item) => Act($"selectItem:{control}={item}", control);

        public void ContextMenu(string control, string item) => Act($"contextMenu:{control}={item}", control);

        public void SaveReload() => owner.Calls.Add("saveReload");

        private void Act(string call, string control)
        {
            owner.Calls.Add(call);
            if (owner.MissingControls.Contains(control))
            {
                throw new InvalidOperationException($"No enabled control '{control}' is on screen.");
            }
        }

        public Bitmap Capture()
        {
            owner.Calls.Add("capture");
            if (owner.PointerMovedBeforeCapture)
            {
                throw new PointerException("scripted pointer move");
            }

            Bitmap bitmap = new(4, 2);
            using Graphics graphics = Graphics.FromImage(bitmap);
            graphics.Clear(owner.CaptureColor);
            return bitmap;
        }

        /// <summary>A main window holding one button, named after the number of trees read so far.</summary>
        public IReadOnlyList<UiNode> DescribeTree()
        {
            owner.Calls.Add("tree");
            if (owner.TreeFailure is not null)
            {
                throw owner.TreeFailure;
            }

            int count = owner.Calls.Count(call => call == "tree");
            return
            [
                Node(null, "frmMain", "ControlType.Window"),
                Node(0, $"cmdButton{count}", "ControlType.Button"),
            ];
        }

        public void Dispose() => owner.Disposed = true;

        private static UiNode Node(int? parent, string automationId, string controlType) => new()
        {
            Parent = parent,
            AutomationId = automationId,
            Name = automationId,
            ControlType = controlType,
            ClassName = "WindowsForms10.Window",
            Enabled = true,
            Bounds = new UiBounds { X = 0, Y = 0, Width = 10, Height = 10 },
        };
    }
}
