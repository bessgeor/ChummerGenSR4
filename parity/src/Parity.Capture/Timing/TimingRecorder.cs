using Parity.Contracts.CaptureTiming;

namespace Parity.Capture.Timing;

/// <summary>
/// Collects the UI operation samples of a run. Samples belong to the side opened with
/// <see cref="BeginSide"/>, so the code that measures needs no case or side of its own.
/// </summary>
internal sealed class TimingRecorder
{
    /// <summary>Operations in the order a side performs them, which is also the report order.</summary>
    private static readonly Operation[] OperationOrder =
        [Operation.Launch, Operation.Activate, Operation.SelectTab, Operation.WaitForLabel, Operation.Wait, Operation.Capture, Operation.Close];

    private readonly List<SideTiming> _sides = [];
    private SideTiming? _current;

    /// <summary>Opens the side that later samples belong to, until the returned scope is disposed.</summary>
    public IDisposable BeginSide(string caseName, string side)
    {
        if (_current is not null)
        {
            throw new InvalidOperationException($"Timing for {_current.Case}/{_current.Side} is still open.");
        }

        _current = new SideTiming { Case = caseName, Side = side == Staging.RunLayout.CanonicalSide ? Side.Canonical : Side.Candidate, Samples = [] };
        _sides.Add(_current);
        return new SideScope(this);
    }

    public void Record(Operation operation, string? target, TimeSpan duration, Exception? error)
    {
        SideTiming side = _current ?? throw new InvalidOperationException($"A {operation} was measured outside any side.");
        side.Samples.Add(new TimingSample
        {
            Operation = operation,
            Target = target,
            Milliseconds = Milliseconds(duration.TotalMilliseconds),
            Succeeded = error is null,
            Error = error?.GetType().Name,
        });
    }

    public CaptureTiming Build(string runId)
    {
        foreach (SideTiming side in _sides)
        {
            side.TotalMilliseconds = Milliseconds(side.Samples.Sum(sample => sample.Milliseconds));
        }

        List<TimingSample> samples = _sides.SelectMany(side => side.Samples).ToList();
        return new CaptureTiming
        {
            RunId = runId,
            Operations = OperationOrder
                .Select(operation => samples.Where(sample => sample.Operation == operation).ToList())
                .Where(group => group.Count > 0)
                .Select(Summarize)
                .ToList(),
            Sides = _sides,
        };
    }

    /// <summary>Nearest-rank percentile: the value at rank ⌈p·n⌉ of the sorted values.</summary>
    public static double Percentile(IReadOnlyList<double> sorted, double share) =>
        sorted[Math.Clamp((int)Math.Ceiling(share * sorted.Count), 1, sorted.Count) - 1];

    private static OperationTiming Summarize(List<TimingSample> group)
    {
        List<double> sorted = group.Select(sample => sample.Milliseconds).Order().ToList();
        return new OperationTiming
        {
            Operation = group[0].Operation,
            Count = group.Count,
            Failures = group.Count(sample => !sample.Succeeded),
            TotalMilliseconds = Milliseconds(sorted.Sum()),
            MedianMilliseconds = Percentile(sorted, 0.5),
            P80Milliseconds = Percentile(sorted, 0.8),
            MaxMilliseconds = sorted[^1],
        };
    }

    private static double Milliseconds(double value) => Math.Round(value, 1);

    private sealed class SideScope(TimingRecorder recorder) : IDisposable
    {
        public void Dispose() => recorder._current = null;
    }
}
