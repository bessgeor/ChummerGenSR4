using Parity.Capture.Execution;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureTiming;
using Parity.Tests.Fakes;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Tests;

public sealed class TimingTests : IDisposable
{
    private static readonly UiTiming Timing = new(TimeSpan.Zero, TimeSpan.Zero);

    private static readonly ParityCase Case = new(
        "build-test",
        "test.chum",
        "test.chum",
        CharacterMode.Build,
        [
            new CaptureAction("common"),
            new SelectTabAction("Adept Powers", Optional: true),
            new WaitForAction("Power Points:"),
            new CaptureAction("adept-powers"),
            new SelectTabAction("Skills", Optional: false),
            new WaitForAction("Active Skills"),
            new WaitAction(5),
            new CaptureAction("skills"),
        ]);

    private readonly string _directory = Directory.CreateTempSubdirectory("parity-timing-").FullName;

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Every_operation_of_a_side_is_measured_in_order()
    {
        TimingRecorder recorder = new();

        Run(new TimedUiDriver(Driver(), recorder, new SteppingTimeProvider()), recorder, "canonical");
        CaptureTiming timing = recorder.Build("test-run");

        SideTiming side = Assert.Single(timing.Sides);
        Assert.Equal("build-test", side.Case);
        Assert.Equal(Side.Canonical, side.Side);
        Assert.Equal(
            [
                Operation.Launch,
                Operation.Activate, Operation.Capture,
                Operation.Activate, Operation.SelectTab,
                Operation.Activate, Operation.SelectTab,
                Operation.Activate, Operation.WaitForLabel,
                Operation.Activate, Operation.Wait,
                Operation.Activate, Operation.Capture,
                Operation.Close,
            ],
            side.Samples.Select(sample => sample.Operation));
        Assert.Equal([2.0, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], side.Samples.Select(sample => sample.Milliseconds));
        Assert.Equal(210, side.TotalMilliseconds);
        Assert.Equal(["Adept Powers", "Skills"], side.Samples.Where(sample => sample.Operation == Operation.SelectTab).Select(sample => sample.Target));
        Assert.Equal("Active Skills", side.Samples.Single(sample => sample.Operation == Operation.WaitForLabel).Target);
        Assert.Equal("5", side.Samples.Single(sample => sample.Operation == Operation.Wait).Target);
    }

    [Fact]
    public void Throwing_call_is_recorded_as_failed_and_the_outcomes_do_not_change()
    {
        TimingRecorder recorder = new();

        SideRun timed = Run(new TimedUiDriver(Driver(), recorder, new SteppingTimeProvider()), recorder, "canonical");
        SideRun plain = Run(Driver(), recorder, "candidate");

        Assert.Equal(plain.Actions, timed.Actions);
        TimingSample absent = recorder.Build("test-run").Sides[0].Samples[4];
        Assert.Equal(Operation.SelectTab, absent.Operation);
        Assert.False(absent.Succeeded);
        Assert.Equal(nameof(TabNotFoundException), absent.Error);
    }

    [Fact]
    public void Failed_launch_is_measured_and_rethrown()
    {
        TimingRecorder recorder = new();
        ScriptedUiDriver driver = Driver();
        InvalidOperationException failure = new("no window");
        driver.LaunchFailure = failure;
        TimedUiDriver timed = new(driver, recorder, new SteppingTimeProvider());

        using (recorder.BeginSide("build-test", "candidate"))
        {
            Assert.Same(failure, Assert.Throws<InvalidOperationException>(() => timed.Launch("app.exe", "test.chum", Timing)));
        }

        TimingSample sample = Assert.Single(recorder.Build("test-run").Sides[0].Samples);
        Assert.Equal(Operation.Launch, sample.Operation);
        Assert.False(sample.Succeeded);
        Assert.Equal(nameof(InvalidOperationException), sample.Error);
    }

    [Fact]
    public void Operations_are_summarized_with_nearest_rank_percentiles()
    {
        TimingRecorder recorder = new();

        Run(new TimedUiDriver(Driver(), recorder, new SteppingTimeProvider()), recorder, "canonical");
        CaptureTiming timing = recorder.Build("test-run");

        Assert.Equal(
            [Operation.Launch, Operation.Activate, Operation.SelectTab, Operation.WaitForLabel, Operation.Wait, Operation.Capture, Operation.Close],
            timing.Operations.Select(operation => operation.Operation));
        OperationTiming activate = timing.Operations[1];
        Assert.Equal(6, activate.Count);
        Assert.Equal(0, activate.Failures);
        Assert.Equal(4 + 8 + 12 + 16 + 20 + 24, activate.TotalMilliseconds);
        Assert.Equal(12, activate.MedianMilliseconds);
        Assert.Equal(20, activate.P80Milliseconds);
        Assert.Equal(24, activate.MaxMilliseconds);
        Assert.Equal(1, timing.Operations[2].Failures);
    }

    [Theory]
    [InlineData(0.5, 3)]
    [InlineData(0.8, 4)]
    [InlineData(0.01, 1)]
    [InlineData(1.0, 5)]
    public void Nearest_rank_percentile(double share, double expected)
    {
        Assert.Equal(expected, TimingRecorder.Percentile([1, 2, 3, 4, 5], share));
    }

    [Fact]
    public void Measuring_outside_a_side_fails()
    {
        TimingRecorder recorder = new();

        Assert.Throws<InvalidOperationException>(() => recorder.Record(Operation.Activate, null, TimeSpan.Zero, null));
    }

    [Fact]
    public void Timing_round_trips_through_the_contract()
    {
        TimingRecorder recorder = new();
        Run(new TimedUiDriver(Driver(), recorder, new SteppingTimeProvider()), recorder, "canonical");
        CaptureTiming timing = recorder.Build("test-run");

        Assert.Equal(ContractJson.Write(timing), ContractJson.Write(ContractJson.ReadTiming(ContractJson.Write(timing))));
    }

    private static ScriptedUiDriver Driver()
    {
        ScriptedUiDriver driver = new();
        driver.Tabs.Add("Skills");
        return driver;
    }

    private SideRun Run(IUiDriver driver, TimingRecorder recorder, string side)
    {
        using (recorder.BeginSide(Case.Name, side))
        {
            return new SideExecutor(driver).Run(
                side,
                Path.Combine(_directory, "app.exe"),
                Case,
                Path.Combine(_directory, "character.chum"),
                Timing,
                null,
                capture => Path.Combine(_directory, side, $"{capture}.png"));
        }
    }
}
