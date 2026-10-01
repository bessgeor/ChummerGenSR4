using Parity.Capture.Coverage;
using Parity.Capture.Execution;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Cases;
using Parity.Contracts.ExecutionCoverage;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Tests;

public sealed class CoverageAuditorTests : IDisposable
{
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
            new CaptureAction("skills"),
        ]);

    private readonly string _folder = Directory.CreateTempSubdirectory("parity-coverage-").FullName;

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public void Complete_side_with_an_absent_optional_tab_is_valid()
    {
        ExecutionCoverage coverage = Audit(Complete(RunLayout.CanonicalSide), Complete(RunLayout.CandidateSide));

        Assert.True(coverage.Valid);
        Assert.Empty(coverage.InvalidReasons);
        SideCoverage side = coverage.Cases[0].Sides[0];
        Assert.True(side.Contiguous);
        Assert.Equal(Source.Live, side.Source);
        Assert.Equal([1], side.OptionalAbsent.Select(action => action.Index));
        Assert.Equal("No tab named 'Adept Powers'.", side.OptionalAbsent[0].Reason);
        Assert.Equal([2, 3], side.SkippedOptional.Select(action => action.Index));
        Assert.Empty(side.Failures);
        Assert.Equal(["common", "adept-powers", "skills"], coverage.Cases[0].PlannedCaptures);
        Assert.Equal([Outcome.Performed, Outcome.SkippedOptional, Outcome.Performed], side.Captures.Select(capture => capture.Outcome));
        Assert.Equal([true, false, true], side.Captures.Select(capture => capture.File));
        Assert.Equal(3, coverage.Totals.PlannedCaptures);
        Assert.Equal(2, coverage.Totals.CapturedPairs);
        Assert.Equal(12, coverage.Totals.Actions);
        Assert.Equal(2, coverage.Totals.OptionalAbsent);
        Assert.Equal(4, coverage.Totals.SkippedOptional);
    }

    [Fact]
    public void Missing_record_is_a_gap()
    {
        SideRun candidate = Complete(RunLayout.CandidateSide);
        candidate = candidate with { Actions = candidate.Actions.Where(action => action.Index != 4).ToList() };

        ExecutionCoverage coverage = Audit(Complete(RunLayout.CanonicalSide), candidate);

        Assert.False(coverage.Valid);
        Assert.Equal(["action-gap:build-test/candidate"], coverage.InvalidReasons);
        Assert.False(coverage.Cases[0].Sides[1].Contiguous);
    }

    [Fact]
    public void Repeated_index_is_a_gap()
    {
        SideRun canonical = Complete(RunLayout.CanonicalSide);
        List<ActionRecord> records = canonical.Actions.ToList();
        records[5] = records[5] with { Index = 4 };

        ExecutionCoverage coverage = Audit(canonical with { Actions = records }, Complete(RunLayout.CandidateSide));

        Assert.Contains("action-gap:build-test/canonical", coverage.InvalidReasons);
        Assert.Equal(Outcome.Missing, coverage.Cases[0].Sides[0].Captures[2].Outcome);
    }

    [Fact]
    public void Record_naming_another_action_is_a_gap()
    {
        SideRun canonical = Complete(RunLayout.CanonicalSide);
        List<ActionRecord> records = canonical.Actions.ToList();
        records[4] = records[4] with { Action = "selectTab:Gear" };

        ExecutionCoverage coverage = Audit(canonical with { Actions = records }, Complete(RunLayout.CandidateSide));

        Assert.Equal(["action-gap:build-test/canonical"], coverage.InvalidReasons);
    }

    [Fact]
    public void Failed_action_is_listed_and_invalid()
    {
        SideRun candidate = Complete(RunLayout.CandidateSide);
        List<ActionRecord> records = candidate.Actions.Take(4).ToList();
        records.Add(new ActionRecord(4, "selectTab:Skills", true, OutcomeKind.Failed, "TimeoutException: late"));
        records.Add(new ActionRecord(5, "capture:skills", true, OutcomeKind.NotRun, null));
        Dictionary<string, string> captures = new(candidate.Captures);
        captures.Remove("skills");

        ExecutionCoverage coverage = Audit(Complete(RunLayout.CanonicalSide), candidate with { Actions = records, Captures = captures, Failure = "action 4: late" });

        Assert.Equal(["failure:build-test/candidate"], coverage.InvalidReasons);
        SideCoverage side = coverage.Cases[0].Sides[1];
        Assert.True(side.Contiguous);
        Assert.Equal(4, Assert.Single(side.Failures).Index);
        Assert.Null(side.StartupFailure);
        Assert.Equal(1, side.NotRun);
        Assert.Equal(1, coverage.Totals.CapturedPairs);
    }

    [Fact]
    public void Startup_failure_is_recorded_and_invalid()
    {
        SideRun canonical = new(
            RunLayout.CanonicalSide,
            Case.Actions.Select((action, index) => new ActionRecord(index, action.Describe(), action.Required, OutcomeKind.NotRun, null)).ToList(),
            new Dictionary<string, string>(),
            "startup: InvalidOperationException: no window",
            TimeSpan.FromSeconds(1));

        ExecutionCoverage coverage = Audit(canonical, Complete(RunLayout.CandidateSide));

        Assert.Equal(["failure:build-test/canonical"], coverage.InvalidReasons);
        Assert.Equal("startup: InvalidOperationException: no window", coverage.Cases[0].Sides[0].StartupFailure);
        Assert.Equal(1, coverage.Totals.StartupFailures);
        Assert.Equal(6, coverage.Totals.NotRun);
    }

    [Fact]
    public void Performed_capture_without_a_file_is_invalid()
    {
        SideRun candidate = Complete(RunLayout.CandidateSide);
        File.Delete(candidate.Captures["skills"]);

        ExecutionCoverage coverage = Audit(Complete(RunLayout.CanonicalSide), candidate);

        Assert.Equal(["capture-without-file:build-test/candidate"], coverage.InvalidReasons);
    }

    [Fact]
    public void File_for_a_capture_that_did_not_perform_is_invalid()
    {
        SideRun canonical = Complete(RunLayout.CanonicalSide);
        Dictionary<string, string> captures = new(canonical.Captures) { ["adept-powers"] = Write(RunLayout.CanonicalSide, "adept-powers") };

        ExecutionCoverage coverage = Audit(canonical with { Captures = captures }, Complete(RunLayout.CandidateSide));

        Assert.Equal(["file-without-capture:build-test/canonical"], coverage.InvalidReasons);
    }

    [Fact]
    public void File_for_an_unplanned_capture_is_invalid()
    {
        SideRun canonical = Complete(RunLayout.CanonicalSide);
        Dictionary<string, string> captures = new(canonical.Captures) { ["extra"] = Write(RunLayout.CanonicalSide, "extra") };

        ExecutionCoverage coverage = Audit(canonical with { Captures = captures }, Complete(RunLayout.CandidateSide));

        Assert.Equal(["file-without-capture:build-test/canonical"], coverage.InvalidReasons);
    }

    [Fact]
    public void Cached_side_is_audited_and_counted()
    {
        SideRun canonical = Complete(RunLayout.CanonicalSide) with { Origin = SideOrigin.Cached(new string('a', 64), "earlier-run") };

        ExecutionCoverage coverage = Audit(canonical, Complete(RunLayout.CandidateSide));

        Assert.True(coverage.Valid);
        Assert.Equal(Source.Cache, coverage.Cases[0].Sides[0].Source);
        Assert.Equal(1, coverage.Totals.CachedSides);
    }

    [Fact]
    public void Coverage_round_trips_through_the_contract()
    {
        ExecutionCoverage coverage = Audit(Complete(RunLayout.CanonicalSide), Complete(RunLayout.CandidateSide));

        ExecutionCoverage readBack = ContractJson.ReadCoverage(ContractJson.Write(coverage));

        Assert.Equal(ContractJson.Write(coverage), ContractJson.Write(readBack));
    }

    private static ExecutionCoverage Audit(SideRun canonical, SideRun candidate) =>
        new CoverageAuditor().Audit("test-run", [new CaseRun(Case, canonical, candidate, [])]);

    private SideRun Complete(string side)
    {
        List<ActionRecord> records =
        [
            new(0, "capture:common", true, OutcomeKind.Performed, null),
            new(1, "selectTab:Adept Powers", false, OutcomeKind.OptionalAbsent, "No tab named 'Adept Powers'."),
            new(2, "waitFor:Power Points:", true, OutcomeKind.SkippedOptional, "optional tab 'Adept Powers' is absent"),
            new(3, "capture:adept-powers", true, OutcomeKind.SkippedOptional, "optional tab 'Adept Powers' is absent"),
            new(4, "selectTab:Skills", true, OutcomeKind.Performed, null),
            new(5, "capture:skills", true, OutcomeKind.Performed, null),
        ];
        Dictionary<string, string> captures = new(StringComparer.Ordinal)
        {
            ["common"] = Write(side, "common"),
            ["skills"] = Write(side, "skills"),
        };
        return new SideRun(side, records, captures, null, TimeSpan.FromSeconds(1));
    }

    private string Write(string side, string capture)
    {
        string path = Path.Combine(_folder, side, $"{capture}.png");
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllBytes(path, [1]);
        return path;
    }
}
