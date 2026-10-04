using System.Runtime.InteropServices;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>
/// Waits until the app's UI thread handles a message: a <c>WM_NULL</c> sent to one of its windows returns only once the
/// thread is back in a message loop, so whatever it was doing has ended. <c>WaitForInputIdle</c> cannot tell this,
/// since it waits only for the first idle state of a process.
/// </summary>
internal sealed class MessageRoundTrip
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(30);

    public void Wait(IntPtr window)
    {
        if (NativeMethods.SendMessageTimeout(
                window, NativeMethods.WmNull, IntPtr.Zero, IntPtr.Zero, NativeMethods.SmtoNormal, (uint)Timeout.TotalMilliseconds, out _) == IntPtr.Zero)
        {
            throw new TimeoutException(
                $"The app did not handle a message within {Timeout.TotalSeconds:0} s (error {Marshal.GetLastWin32Error()}).");
        }
    }
}
