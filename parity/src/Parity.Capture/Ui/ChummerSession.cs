using System.Diagnostics;
using System.Runtime.InteropServices;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// One running app process. Keeps the main window handle and resolved tab items, and re-resolves
/// them when the app recreates its window or tab controls.
/// </summary>
internal sealed class ChummerSession(
    Process process,
    UiTiming timing,
    WindowFinder finder,
    WindowActivator activator,
    WindowGeometry geometry,
    TabNavigator tabs,
    LabelWaiter labels,
    WindowCapturer capturer) : IAppSession
{
    private static readonly TimeSpan WindowTimeout = TimeSpan.FromSeconds(60);
    private static readonly TimeSpan LiveWindowTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan InputIdleTimeout = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan FirstSelectionCheck = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan SelectionTimeout = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan CharacterFormTimeout = TimeSpan.FromSeconds(10);

    private readonly Dictionary<string, AccessibleTab> _tabCache = new(StringComparer.Ordinal);
    private IntPtr _mainWindow;
    private IntPtr _stableWindow;
    private Rectangle? _stableBounds;

    /// <summary>Waits for the main window, maximizes it, and waits for input idle and stable bounds.</summary>
    public void WaitUntilReady()
    {
        _mainWindow = finder.WaitForMainWindow(process, WindowTimeout);
        NativeMethods.ShowWindow(_mainWindow, NativeMethods.SwMaximize);
        activator.Activate(_mainWindow);
        WaitForInputIdle();
        WaitForStableBounds();
        Thread.Sleep(timing.StartupDelay);
        process.Refresh();
        WaitForInputIdle();
        WaitForStableBounds();
        EnsureCharacterOpen();
    }

    public void Activate() => activator.Activate(LiveWindow());

    public void SelectTab(string tabName)
    {
        IntPtr window = LiveWindow();
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
        labels.WaitForVisibleLabel(LiveWindow(), label);
        Thread.Sleep(timing.Settle);
    }

    public void Wait(int milliseconds) => Thread.Sleep(milliseconds);

    public Bitmap Capture()
    {
        Rectangle bounds = WaitForStableBounds();
        IntPtr window = LiveWindow();
        activator.Activate(window);
        capturer.FocusStatusBar(window);
        return capturer.Capture(window, bounds);
    }

    public void Dispose()
    {
        try
        {
            if (!process.HasExited)
            {
                process.CloseMainWindow();
                if (!process.WaitForExit(500))
                {
                    process.Kill(entireProcessTree: true);
                    process.WaitForExit();
                }
            }
        }
        finally
        {
            process.Dispose();
        }
    }

    private IntPtr LiveWindow()
    {
        if (finder.IsLiveWindow(_mainWindow, process.Id))
        {
            return _mainWindow;
        }

        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < LiveWindowTimeout)
        {
            process.Refresh();
            if (process.HasExited)
            {
                throw new InvalidOperationException($"The app exited with code {process.ExitCode} during the case.");
            }

            IntPtr handle = finder.FindMainWindow(process.Id);
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

    /// <summary>Returns the cached bounds when the same window still has them; otherwise waits for stability.</summary>
    private Rectangle WaitForStableBounds()
    {
        IntPtr window = LiveWindow();
        if (_stableWindow == window && _stableBounds is { } cached && geometry.GetVisibleBounds(window) == cached)
        {
            return cached;
        }

        Rectangle bounds = geometry.WaitForStableBounds(LiveWindow, timing.Settle);
        _stableWindow = LiveWindow();
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
        if (!process.WaitForInputIdle(InputIdleTimeout))
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
