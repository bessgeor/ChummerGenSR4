using Parity.Capture.Cache;
using Parity.Capture.Execution;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureResults;

namespace Parity.Capture.Run;

/// <summary>
/// Runs a case on the canonical side, then the candidate side, then compares their captures; with UI trees, the
/// candidate side records one after each capture. With a
/// cache, the canonical side is restored when its key is stored; one that completed live is queued for
/// the run to store once the canonical executable is verified again.
/// </summary>
internal sealed class CaseRunner(
    SideExecutor executor,
    VisualResultBuilder results,
    TimingRecorder timingRecorder,
    CacheKeyBuilder keyBuilder,
    CanonicalCaptureCache cache)
{
    public CaseRun Run(
        ParityCase parityCase,
        RunLayout layout,
        StagedRun staged,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter,
        double threshold,
        CacheSession? cacheSession,
        bool uiTrees)
    {
        string character = staged.CharacterCopies[parityCase.Name];
        SideRun canonical = cacheSession is null
            ? RunSide(RunLayout.CanonicalSide, staged.CanonicalExecutable, parityCase, character, layout, timing, captureFilter)
            : RunCanonicalWithCache(cacheSession, parityCase, character, layout, staged, timing, captureFilter);
        SideRun candidate = RunSide(RunLayout.CandidateSide, staged.CandidateExecutable, parityCase, character, layout, timing, captureFilter,
            uiTrees ? new UiTreeRecorder(layout, parityCase.Name) : null);
        IReadOnlyList<CaptureResult> rows = results.Build(parityCase, canonical, candidate, threshold, layout.Relative);
        return new CaseRun(parityCase, canonical, candidate, rows);
    }

    private SideRun RunCanonicalWithCache(
        CacheSession session,
        ParityCase parityCase,
        string character,
        RunLayout layout,
        StagedRun staged,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter)
    {
        CacheKey key = keyBuilder.Build(session, staged.CanonicalSha256, parityCase, captureFilter, timing);
        SideRun? cached = cache.TryRestore(session, key, captureName => layout.CapturePath(parityCase.Name, RunLayout.CanonicalSide, captureName));
        if (cached is not null)
        {
            session.Hits++;
            Console.WriteLine($"  {RunLayout.CanonicalSide}: from the cache, entry {key.Value} stored by run {cached.Origin.CachedFromRun}");
            return cached;
        }

        session.Misses++;
        SideRun live = RunSide(RunLayout.CanonicalSide, staged.CanonicalExecutable, parityCase, character, layout, timing, captureFilter)
            with { Origin = SideOrigin.LiveWithKey(key.Value) };
        if (live.Failed)
        {
            Console.WriteLine($"  {RunLayout.CanonicalSide}: failed, so it is not stored in the cache");
        }
        else
        {
            session.Pending.Add(new PendingStore(key, layout.RunId, live));
        }

        return live;
    }

    private SideRun RunSide(
        string side,
        string executable,
        ParityCase parityCase,
        string character,
        RunLayout layout,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter,
        UiTreeRecorder? trees = null)
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
                captureName => layout.CapturePath(parityCase.Name, side, captureName),
                trees);
        }

        Console.WriteLine(run.Failed
            ? $"  {side}: FAILED after {run.Duration.TotalSeconds:0.0} s: {run.Failure}"
            : $"  {side}: completed in {run.Duration.TotalSeconds:0.0} s, {run.Captures.Count} captures");
        return run;
    }
}
