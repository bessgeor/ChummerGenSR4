using Parity.Capture.Execution;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureResults;

namespace Parity.Capture.Run;

/// <summary>Runs a case on the canonical side, then the candidate side, then compares their captures.</summary>
internal sealed class CaseRunner(SideExecutor executor, VisualResultBuilder results, TimingRecorder timingRecorder)
{
    public CaseRun Run(
        ParityCase parityCase,
        RunLayout layout,
        StagedRun staged,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter,
        double threshold)
    {
        string character = staged.CharacterCopies[parityCase.Name];
        SideRun canonical = RunSide(RunLayout.CanonicalSide, staged.CanonicalExecutable, parityCase, character, layout, timing, captureFilter);
        SideRun candidate = RunSide(RunLayout.CandidateSide, staged.CandidateExecutable, parityCase, character, layout, timing, captureFilter);
        IReadOnlyList<CaptureResult> rows = results.Build(parityCase, canonical, candidate, threshold, layout.Relative);
        return new CaseRun(parityCase, canonical, candidate, rows);
    }

    private SideRun RunSide(
        string side,
        string executable,
        ParityCase parityCase,
        string character,
        RunLayout layout,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter)
    {
        Console.WriteLine($"  {side}: {executable}");
        SideRun run;
        using (timingRecorder.BeginSide(parityCase.Name, side))
        {
            run = executor.Run(
                side,
                executable,
                parityCase,
                character,
                timing,
                captureFilter,
                captureName => layout.CapturePath(parityCase.Name, side, captureName));
        }

        Console.WriteLine(run.Failed
            ? $"  {side}: FAILED after {run.Duration.TotalSeconds:0.0} s: {run.Failure}"
            : $"  {side}: completed in {run.Duration.TotalSeconds:0.0} s, {run.Captures.Count} captures");
        return run;
    }
}
