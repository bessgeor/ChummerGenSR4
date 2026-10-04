using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class DialogSafeCallerTests
{
    private static readonly TimeSpan Short = TimeSpan.FromMilliseconds(300);

    [Fact]
    public void A_call_that_returns_is_done()
    {
        DialogSafeCaller caller = new();
        bool called = false;

        caller.Run("click:cmdOK", () => called = true, () => 1, DialogSafeCaller.Timeout);

        Assert.True(called);
        caller.ThrowIfEarlierCallFailed();
    }

    [Fact]
    public void A_call_that_throws_rethrows_its_own_exception()
    {
        DialogSafeCaller caller = new();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(
            () => caller.Run("click:cmdOK", () => throw new InvalidOperationException("not enabled"), () => 1, DialogSafeCaller.Timeout));

        Assert.Equal("not enabled", error.Message);
    }

    [Fact]
    public void A_call_that_opens_a_window_is_done_while_it_runs()
    {
        DialogSafeCaller caller = new();
        using ManualResetEventSlim dialogClosed = new();
        IntPtr active = 1;

        caller.Run("click:cmdAddGear", () => { active = 2; dialogClosed.Wait(); }, () => active, DialogSafeCaller.Timeout);

        caller.ThrowIfEarlierCallFailed();
        dialogClosed.Set();
    }

    [Fact]
    public void A_call_that_neither_returns_nor_opens_a_window_times_out()
    {
        DialogSafeCaller caller = new();
        using ManualResetEventSlim release = new();

        TimeoutException error = Assert.Throws<TimeoutException>(() => caller.Run("click:cmdOK", release.Wait, () => 1, Short));

        Assert.Contains("click:cmdOK neither returned nor opened a window", error.Message);
        release.Set();
    }

    [Fact]
    public void A_window_that_is_none_while_it_changes_does_not_count()
    {
        DialogSafeCaller caller = new();
        using ManualResetEventSlim release = new();

        Assert.Throws<TimeoutException>(() => caller.Run("click:cmdOK", release.Wait, () => 0, Short));
        release.Set();
    }

    [Fact]
    public void A_later_failure_of_a_kept_call_reaches_the_next_action_once()
    {
        DialogSafeCaller caller = new();
        using ManualResetEventSlim dialogClosed = new();
        using ManualResetEventSlim callEnded = new();
        IntPtr active = 1;
        caller.Run(
            "contextMenu:treGear=Add as Plugin",
            () =>
            {
                active = 2;
                dialogClosed.Wait();
                callEnded.Set();
                throw new InvalidOperationException("element gone");
            },
            () => active,
            DialogSafeCaller.Timeout);

        caller.ThrowIfEarlierCallFailed();
        dialogClosed.Set();
        callEnded.Wait(TestContext.Current.CancellationToken);
        SpinWait.SpinUntil(() => false, 50);

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(caller.ThrowIfEarlierCallFailed);
        Assert.Equal("contextMenu:treGear=Add as Plugin failed after it had opened a window: InvalidOperationException: element gone", error!.Message);
        caller.ThrowIfEarlierCallFailed();
    }
}
