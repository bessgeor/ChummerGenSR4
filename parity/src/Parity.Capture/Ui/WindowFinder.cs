using System.Diagnostics;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Finds the main window of a launched process: its largest visible top-level window.</summary>
internal sealed class WindowFinder
{
    public IntPtr FindMainWindow(int processId)
    {
        IntPtr result = IntPtr.Zero;
        long bestArea = 0;
        NativeMethods.EnumWindows((handle, _) =>
        {
            NativeMethods.GetWindowThreadProcessId(handle, out int owner);
            if (owner != processId || !NativeMethods.IsWindowVisible(handle) || !NativeMethods.GetWindowRect(handle, out NativeMethods.Rect rect))
            {
                return true;
            }

            long area = Math.Max(0, rect.Right - rect.Left) * (long)Math.Max(0, rect.Bottom - rect.Top);
            if (area > bestArea)
            {
                bestArea = area;
                result = handle;
            }

            return true;
        }, IntPtr.Zero);
        return result;
    }

    public bool IsLiveWindow(IntPtr handle, int processId)
    {
        if (handle == IntPtr.Zero || !NativeMethods.IsWindow(handle) || !NativeMethods.IsWindowVisible(handle))
        {
            return false;
        }

        NativeMethods.GetWindowThreadProcessId(handle, out int owner);
        return owner == processId;
    }

    /// <summary>Polls until the process shows a visible window; fails if it exits or times out.</summary>
    public IntPtr WaitForMainWindow(Process process, TimeSpan timeout)
    {
        Stopwatch timer = Stopwatch.StartNew();
        while (timer.Elapsed < timeout)
        {
            process.Refresh();
            if (process.HasExited)
            {
                throw new InvalidOperationException(
                    $"Process {process.Id} exited with code {process.ExitCode} before showing a window.");
            }

            IntPtr handle = FindMainWindow(process.Id);
            if (handle != IntPtr.Zero)
            {
                return handle;
            }

            Thread.Sleep(200);
        }

        throw new TimeoutException($"Process {process.Id} showed no visible window within {timeout.TotalSeconds:0} s.");
    }
}
