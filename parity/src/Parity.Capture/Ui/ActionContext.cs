namespace Parity.Capture.Ui;

/// <summary>What an acting call needs from its session: the active window, the caller, the wait after a call and the process.</summary>
internal sealed record ActionContext(Func<IntPtr> ActiveWindow, DialogSafeCaller Caller, Action Settle, int ProcessId);
