using Parity.Capture.Ui;

namespace Parity.Tests.Fakes;

/// <summary>A UI driver whose app has a fixed set of tabs and labels and scripted failures.</summary>
internal sealed class ScriptedUiDriver : IUiDriver
{
    public HashSet<string> Tabs { get; } = new(StringComparer.Ordinal);

    public HashSet<string> MissingLabels { get; } = new(StringComparer.Ordinal);

    public Exception? LaunchFailure { get; set; }

    public int ActivationFailuresBeforeCapture { get; set; } = -1;

    public bool PointerMovedBeforeCapture { get; set; }

    public Color CaptureColor { get; set; } = Color.White;

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

        public void Dispose() => owner.Disposed = true;
    }
}
