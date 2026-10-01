using Parity.Capture.Ui;
using Parity.Contracts.CaptureTiming;

namespace Parity.Capture.Timing;

/// <summary>
/// Decorates a UI driver: measures every launch and wraps each session so its operations are measured
/// too. Outcomes and exceptions pass through unchanged.
/// </summary>
internal sealed class TimedUiDriver(IUiDriver inner, TimingRecorder recorder, TimeProvider time) : IUiDriver
{
    public IAppSession Launch(string executablePath, string characterPath, UiTiming timing)
    {
        IAppSession session = Measure(Operation.Launch, null, () => inner.Launch(executablePath, characterPath, timing));
        return new TimedAppSession(session, this);
    }

    internal T Measure<T>(Operation operation, string? target, Func<T> call)
    {
        long started = time.GetTimestamp();
        T result;
        try
        {
            result = call();
        }
        catch (Exception error)
        {
            recorder.Record(operation, target, time.GetElapsedTime(started), error);
            throw;
        }

        recorder.Record(operation, target, time.GetElapsedTime(started), null);
        return result;
    }

    internal void Measure(Operation operation, string? target, Action call) =>
        Measure<object?>(operation, target, () =>
        {
            call();
            return null;
        });
}
