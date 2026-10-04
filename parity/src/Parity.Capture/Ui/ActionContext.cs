namespace Parity.Capture.Ui;

/// <summary>
/// What an acting call needs from its session: the active window (waiting for one while a dialog opens), the active
/// window as it is now (none while a dialog opens), the caller, the wait after a call and the process.
/// </summary>
internal sealed record ActionContext(Func<IntPtr> ActiveWindow, Func<IntPtr> CurrentWindow, DialogSafeCaller Caller, Action Settle, int ProcessId);
