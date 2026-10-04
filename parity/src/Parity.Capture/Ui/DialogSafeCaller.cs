using System.Diagnostics;
using System.Runtime.ExceptionServices;

namespace Parity.Capture.Ui;

/// <summary>
/// Runs a call into the app that may not return while a dialog it opens is shown: WinForms carries out a UI
/// Automation invoke or selection inside its message loop, and a handler that shows a modal dialog returns only when
/// the dialog closes. The call runs on a thread of its own; it is done when it returns or the active window changes.
/// A call still running then is kept, and its later failure is raised by <see cref="ThrowIfEarlierCallFailed"/>.
/// </summary>
internal sealed class DialogSafeCaller
{
    public static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan Poll = TimeSpan.FromMilliseconds(50);

    private readonly List<(string Description, Task Call)> _running = [];

    /// <summary>
    /// Starts <paramref name="call"/> and waits until it returns, rethrowing its exception, or until
    /// <paramref name="activeWindow"/> names another non-zero window than before; throws <see cref="TimeoutException"/>
    /// when neither happens within <paramref name="timeout"/>.
    /// </summary>
    public void Run(string description, Action call, Func<IntPtr> activeWindow, TimeSpan timeout)
    {
        IntPtr before = activeWindow();
        Task task = Task.Factory.StartNew(call, CancellationToken.None, TaskCreationOptions.LongRunning, TaskScheduler.Default);
        Stopwatch timer = Stopwatch.StartNew();
        while (true)
        {
            if (((IAsyncResult)task).AsyncWaitHandle.WaitOne(Poll))
            {
                if (task.Exception is { } failure)
                {
                    ExceptionDispatchInfo.Capture(failure.InnerExceptions.Count == 1 ? failure.InnerExceptions[0] : failure).Throw();
                }

                return;
            }

            IntPtr now = activeWindow();
            if (now != IntPtr.Zero && now != before)
            {
                _running.Add((description, task));
                return;
            }

            if (timer.Elapsed >= timeout)
            {
                throw new TimeoutException(
                    $"{description} neither returned nor opened a window within {timeout.TotalSeconds:0} s.");
            }
        }
    }

    /// <summary>Throws the failure of a kept call that has ended with one; forgets the calls that ended.</summary>
    public void ThrowIfEarlierCallFailed()
    {
        for (int index = 0; index < _running.Count; index++)
        {
            (string description, Task task) = _running[index];
            if (!task.IsCompleted)
            {
                continue;
            }

            _running.RemoveAt(index--);
            if (task.Exception is { } failure)
            {
                Exception inner = failure.InnerExceptions.Count == 1 ? failure.InnerExceptions[0] : failure;
                throw new InvalidOperationException(
                    $"{description} failed after it had opened a window: {inner.GetType().Name}: {inner.Message}", inner);
            }
        }
    }
}
