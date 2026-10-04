using System.Diagnostics;
using System.Runtime.InteropServices;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// One running app _process. Keeps the main window handle and resolved tab items, and re-resolves
/// them when the app recreates its window or tab controls. Every action applies to the active window: the
/// main window, or the modal dialog it shows. A save and reload replaces the process with a new one on the same file.
/// </summary>
internal sealed class ChummerSession(
    Process process,
    Func<Process> restart,
    string characterPath,
    UiTiming timing,
    WindowFinder finder,
    WindowActivator activator,
    WindowGeometry geometry,
    TabNavigator tabs,
    LabelWaiter labels,
    WindowCapturer capturer,
    PointerParker pointer,
    UiTreeReader trees,
    ActiveWindowResolver activeWindows,
    ControlActions controls,
    CharacterSaver saver) : IAppSession
{
    private static readonly TimeSpan WindowTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan LiveWindowTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan InputIdleTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan FirstSelectionCheck = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan SelectionTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan CharacterFormTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan ActiveWindowTimeout = TimeSpan.FromSeconds(2);
    private static readonly TimeSpan ExitTimeout = TimeSpan.FromSeconds(30);

    private readonly Dictionary<string, AccessibleTab> _tabCache = new(StringComparer.Ordinal);
    private readonly DialogSafeCaller _caller = new();
    private IntPtr _tabWindow;
    private IntPtr _mainWindow;
    private IntPtr _stableWindow;
    private Rectangle? _stableBounds;
    private Point _pointerSpot;
    private Process _process = process;

    /// <summary>
    /// Waits for a window and input idle, then maximizes and activates the largest window, waits
    /// for input idle and stable bounds, and parks the pointer on its title bar before the startup
    /// delay. Activating before the app is idle races its own startup.
    /// </summary>
    public void WaitUntilReady()
    {
        finder.WaitForMainWindow(_process, WindowTimeout);
        WaitForInputIdle();
        _mainWindow = finder.WaitForMainWindow(_process, WindowTimeout);
        NativeMethods.ShowWindow(_mainWindow, NativeMethods.SwMaximize);
        activator.Activate(_mainWindow);
        WaitForInputIdle();
        _pointerSpot = pointer.Park(WaitForStableBounds());
        Thread.Sleep(timing.StartupDelay);
        _process.Refresh();
        WaitForInputIdle();
        WaitForStableBounds();
        EnsureCharacterOpen();
    }

    /// <summary>Raises the failure of an earlier action's call that ended after its action, then activates the active window.</summary>
    public void Activate()
    {
        _caller.ThrowIfEarlierCallFailed();
        activator.Activate(ActiveWindow());
    }

    public void SelectTab(string tabName)
    {
        IntPtr window = ActiveWindow();
        if (window != _tabWindow)
        {
            _tabCache.Clear();
            _tabWindow = window;
        }

        if (!_tabCache.TryGetValue(tabName, out AccessibleTab? tab))
        {
            tab = tabs.Find(window, tabName);
            _tabCache[tabName] = tab;
        }

        try
        {
            tabs.Select(tab);
        }
        catch (COMException)
        {
            // WinForms can recreate a tab control while a form loads; resolve it again once.
            tab = Rediscover(window, tabName, "a selection error");
            tabs.Select(tab);
        }

        if (IsSelectedWithin(tab, FirstSelectionCheck))
        {
            return;
        }

        // The control can replace its MSAA object while handling the default action.
        tab = Rediscover(window, tabName, "a missed selection");
        tabs.Select(tab);
        if (!IsSelectedWithin(tab, SelectionTimeout))
        {
            throw new TimeoutException(
                $"Tab '{tabName}' was not selected within {SelectionTimeout.TotalSeconds:0} s. {tabs.DescribeSelection(tab)}");
        }
    }

    public void WaitForLabel(string label)
    {
        WaitForStableBounds();
        labels.WaitForVisibleLabel(ActiveWindow, label);
        Thread.Sleep(timing.Settle);
    }

    public void Wait(int milliseconds) => Thread.Sleep(milliseconds);

    public void SetValue(string control, string value) => controls.SetValue(Acting(), control, value);

    public void Click(string control) => controls.Click(Acting(), control);

    public void SelectItem(string control, string item) => controls.SelectItem(Acting(), control, item);

    public void ContextMenu(string control, string item) => controls.ContextMenu(Acting(), control, item);

    /// <summary>
    /// Saves from the character form, closes the app, which must exit by itself, and opens the saved file in a new
    /// process, waiting for it as at startup.
    /// </summary>
    public void SaveReload()
    {
        IntPtr main = LiveWindow();
        if (ActiveWindow() != main)
        {
            throw new InvalidOperationException(
                $"The dialog '{ControlFinder.Title(ActiveWindow())}' is open; the character is saved from the character form.");
        }

        saver.Save(main, characterPath, WaitForInputIdle);
        _process.CloseMainWindow();
        if (!_process.WaitForExit(ExitTimeout))
        {
            throw new InvalidOperationException(
                $"The app did not exit within {ExitTimeout.TotalSeconds:0} s after saving; its active window is '{ControlFinder.Title(ActiveWindow())}'.");
        }

        Process next = restart();
        _process.Dispose();
        _process = next;
        _tabCache.Clear();
        _tabWindow = IntPtr.Zero;
        _stableWindow = IntPtr.Zero;
        _stableBounds = null;
        WaitUntilReady();
    }

    /// <summary>Captures the active window; only the character form has a status bar to move the focus to.</summary>
    public Bitmap Capture()
    {
        Rectangle bounds = WaitForStableBounds();
        IntPtr window = ActiveWindow();
        activator.Activate(window);
        if (window == LiveWindow())
        {
            capturer.FocusStatusBar(window);
        }

        pointer.EnsureAt(_pointerSpot);
        return capturer.Capture(window, bounds);
    }

    public IReadOnlyList<Parity.Contracts.UiTree.UiNode> DescribeTree() => trees.Read(ActiveWindow());

    public void Dispose()
    {
        try
        {
            if (!_process.HasExited)
            {
                _process.CloseMainWindow();
                if (!_process.WaitForExit(500))
                {
                    _process.Kill(entireProcessTree: true);
                    _process.WaitForExit();
                }
            }
        }
        finally
        {
            _process.Dispose();
        }
    }

    private IntPtr LiveWindow()
    {
        if (finder.IsLiveWindow(_mainWindow, _process.Id))
        {
            return _mainWindow;
        }

        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < LiveWindowTimeout)
        {
            _process.Refresh();
            if (_process.HasExited)
            {
                throw new InvalidOperationException($"The app exited with code {_process.ExitCode} during the case.");
            }

            IntPtr handle = finder.FindMainWindow(_process.Id);
            if (handle != IntPtr.Zero)
            {
                _mainWindow = handle;
                _tabCache.Clear();
                return handle;
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException($"The app's main window disappeared for more than {LiveWindowTimeout.TotalSeconds:0} s.");
    }

    private ActionContext Acting() => new(ActiveWindow, _caller, Settle, _process.Id);

    /// <summary>After an acting call: the app is idle, then the settle time passes for it to paint.</summary>
    private void Settle()
    {
        WaitForInputIdle();
        Thread.Sleep(timing.Settle);
    }

    /// <summary>The active window; a disabled window that owns no enabled one for <see cref="ActiveWindowTimeout"/> is a failure.</summary>
    private IntPtr ActiveWindow()
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (true)
        {
            IntPtr window = activeWindows.Resolve(LiveWindow());
            if (window != IntPtr.Zero)
            {
                return window;
            }

            if (timer.Elapsed >= ActiveWindowTimeout)
            {
                throw new InvalidOperationException(
                    $"The app's window is disabled and has no enabled dialog for {ActiveWindowTimeout.TotalSeconds:0} s.");
            }

            Thread.Sleep(100);
        }
    }

    /// <summary>Returns the cached bounds when the active window is the same and still has them; otherwise waits for stability.</summary>
    private Rectangle WaitForStableBounds()
    {
        IntPtr window = ActiveWindow();
        if (_stableWindow == window && _stableBounds is { } cached && geometry.GetVisibleBounds(window) == cached)
        {
            return cached;
        }

        Rectangle bounds = geometry.WaitForStableBounds(ActiveWindow, timing.Settle);
        _stableWindow = ActiveWindow();
        _stableBounds = bounds;
        return bounds;
    }

    /// <summary>
    /// The character form has a status bar. Without one, the largest window is something else, such
    /// as an unhandled-exception dialog, and the character did not open.
    /// </summary>
    private void EnsureCharacterOpen()
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < CharacterFormTimeout)
        {
            if (capturer.FindStatusBar(LiveWindow()) != IntPtr.Zero)
            {
                return;
            }

            Thread.Sleep(200);
        }

        string title = System.Windows.Automation.AutomationElement.FromHandle(LiveWindow()).Current.Name;
        throw new InvalidOperationException(
            $"The character did not open within {CharacterFormTimeout.TotalSeconds:0} s: the largest window is '{title}' and has no status bar.");
    }

    private void WaitForInputIdle()
    {
        if (!_process.WaitForInputIdle(InputIdleTimeout))
        {
            throw new TimeoutException($"The app did not become idle within {InputIdleTimeout.TotalSeconds:0} s.");
        }
    }

    /// <summary>A stale MSAA object while polling counts as not selected; the caller re-resolves the tab.</summary>
    private bool IsSelectedWithin(AccessibleTab tab, TimeSpan timeout)
    {
        try
        {
            return tabs.WaitUntilSelected(tab, timeout);
        }
        catch (COMException)
        {
            return false;
        }
    }

    /// <summary>Resolves the tab again; a tab that vanished here is a failure, never an optional absence.</summary>
    private AccessibleTab Rediscover(IntPtr window, string tabName, string reason)
    {
        _tabCache.Remove(tabName);
        try
        {
            AccessibleTab tab = tabs.Find(window, tabName);
            _tabCache[tabName] = tab;
            return tab;
        }
        catch (TabNotFoundException error)
        {
            throw new InvalidOperationException($"Tab '{tabName}' disappeared while retrying after {reason}.", error);
        }
    }
}
