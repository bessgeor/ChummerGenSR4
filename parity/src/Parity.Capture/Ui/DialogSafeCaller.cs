using System.Diagnostics;
using System.Runtime.ExceptionServices;

namespace Parity.Capture.Ui;

/// <summary>
/// Runs a call into the app that may not return while a dialog it opens is shown: WinForms carries out a UI
/// Automation invoke or selection inside its message loop, and a handler that shows a modal dialog returns only when
/// the dialog closes. The call runs on a thread of its own; it is done when it returns or the active window changes.
/// A call still running then is kept until the window it started from is active again, which is when its dialog has
/// closed: <see cref="CheckKeptCalls"/> then waits for it to return and raises its failure.
/// </summary>
internal sealed class DialogSafeCaller
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan Poll = TimeSpan.FromMilliseconds(50);

    private readonly List<KeptCall> _kept = [];

    /// <summary>
    /// Starts <paramref name="call"/> and waits until it returns, rethrowing its exception, or until
    /// <paramref name="activeWindow"/> names another non-zero window than before; throws <see cref="TimeoutException"/>
    /// when neither happens within <paramref name="timeout"/>. Returns whether the call returned.
    /// </summary>
    public bool Run(string description, Action call, Func<IntPtr> activeWindow, TimeSpan timeout)
    {
        IntPtr before = activeWindow();
        Task task = Task.Factory.StartNew(call, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        Stopwatch timer = Stopwatch.StartNew();
        while (true)
        {
            if (((IAsyncResult)task).AsyncWaitHandle.WaitOne(Poll))
            {
                Rethrow(task);
                return true;
            }

            IntPtr now = activeWindow();
            if (now != IntPtr.Zero && now != before)
            {
                _kept.Add(new KeptCall(description, task, before));
                return false;
            }

            if (timer.Elapsed >= timeout)
            {
                throw new TimeoutException(
                    $"{description} neither returned nor opened a window within {timeout.TotalSeconds:0} s.");
            }
        }
    }

    /// <summary>
    /// Raises the failure of a kept call that has ended with one. A kept call whose window is active again must
    /// return within <see cref="Timeout"/>; one that does not is a failure too. Calls that ended are forgotten.
    /// </summary>
    public void CheckKeptCalls(Func<IntPtr> activeWindow)
    {
        for (int index = 0; index < _kept.Count; index++)
        {
            KeptCall kept = _kept[index];
            if (!kept.Call.IsCompleted && activeWindow() == kept.Window
                && !((IAsyncResult)kept.Call).AsyncWaitHandle.WaitOne(Timeout))
            {
                throw new TimeoutException(
                    $"{kept.Description} did not return within {Timeout.TotalSeconds:0} s after the window it opened had closed.");
            }

            if (!kept.Call.IsCompleted)
            {
                continue;
            }

            _kept.RemoveAt(index--);
            if (kept.Call.Exception is { } failure)
            {
                Exception inner = failure.InnerExceptions.Count == 1 ? failure.InnerExceptions[0] : failure;
                throw new InvalidOperationException(
                    $"{kept.Description} failed after it had opened a window: {inner.GetType().Name}: {inner.Message}", inner);
            }
        }
    }

    private static void Rethrow(Task task)
    {
        if (task.Exception is { } failure)
        {
            ExceptionDispatchInfo.Capture(failure.InnerExceptions.Count == 1 ? failure.InnerExceptions[0] : failure).Throw();
        }
    }

    /// <summary>A call still running after its action, and the window that was active when it started.</summary>
    private sealed record KeptCall(string Description, Task Call, IntPtr Window);
}
