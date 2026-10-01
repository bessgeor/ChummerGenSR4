namespace Parity.Tests.Fakes;

/// <summary>
/// A clock in milliseconds that advances on every reading, by one more millisecond than the reading before,
/// so the n-th measured call (a start and an end reading) lasts 2n ms.
/// </summary>
internal sealed class SteppingTimeProvider : TimeProvider
{
    private long _now;
    private long _step;

    public override long TimestampFrequency => 1000;

    public override long GetTimestamp()
    {
        _step++;
        _now += _step;
        return _now;
    }
}
