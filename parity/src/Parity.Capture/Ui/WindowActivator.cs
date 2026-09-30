using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// Brings a window to the foreground. Another window can hold the foreground lock for a moment,
/// so activation is retried a bounded number of times before it fails.
/// </summary>
internal sealed class WindowActivator
{
    public const int Attempts = 10;
    public static readonly TimeSpan RetryDelay = TimeSpan.FromMilliseconds(200);

    public void Activate(IntPtr handle)
    {
        if (handle == IntPtr.Zero)
        {
            throw new WindowActivationException("there is no window handle to activate.");
        }

        for (int attempt = 1; attempt <= Attempts; attempt++)
        {
            if (TryActivate(handle))
            {
                return;
            }

            if (attempt < Attempts)
            {
                Thread.Sleep(RetryDelay);
            }
        }

        throw new WindowActivationException(
            $"window {handle} was not in the foreground after {Attempts} attempts {RetryDelay.TotalMilliseconds:0} ms apart " +
            $"(foreground window {NativeMethods.GetForegroundWindow()}).");
    }

    private static bool TryActivate(IntPtr handle)
    {
        uint targetThreadId = NativeMethods.GetWindowThreadProcessId(handle, out _);
        uint sourceThreadId = NativeMethods.GetCurrentThreadId();
        IntPtr foreground = NativeMethods.GetForegroundWindow();
        uint foregroundThreadId = foreground == IntPtr.Zero
            ? sourceThreadId
            : NativeMethods.GetWindowThreadProcessId(foreground, out _);
        bool attachedToForeground = sourceThreadId != foregroundThreadId
                                    && NativeMethods.AttachThreadInput(sourceThreadId, foregroundThreadId, true);
        bool attachedToTarget = sourceThreadId != targetThreadId
                                && targetThreadId != foregroundThreadId
                                && NativeMethods.AttachThreadInput(sourceThreadId, targetThreadId, true);
        try
        {
            NativeMethods.BringWindowToTop(handle);
            return NativeMethods.SetForegroundWindow(handle) && NativeMethods.GetForegroundWindow() == handle;
        }
        finally
        {
            if (attachedToTarget)
            {
                NativeMethods.AttachThreadInput(sourceThreadId, targetThreadId, false);
            }

            if (attachedToForeground)
            {
                NativeMethods.AttachThreadInput(sourceThreadId, foregroundThreadId, false);
            }
        }
    }
}
