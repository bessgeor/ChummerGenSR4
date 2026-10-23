using Microsoft.Extensions.DependencyInjection;
using Parity.Capture.Execution;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Cases;
using Parity.Contracts.CaptureSummary;
using CaptureResult = Parity.Contracts.CaptureResults.CaptureResult;
using ResultReason = Parity.Contracts.CaptureResults.ResultReason;

namespace Parity.Tests;

public sealed class CaptureRunTests
{
    [Fact]
    public void Options_have_repository_defaults()
    {
        CaptureOptions options = new CaptureOptionsParser().Parse([]);

        Assert.Equal(Path.Combine("parity", "cases", "characters.json"), options.CaseFile);
        Assert.Equal(Path.Combine("bin", "ChummerGenSR4.exe"), options.CanonicalExecutable);
        Assert.Equal(Path.Combine("out", "candidate", "bin", "ChummerGenSR4.exe"), options.CandidateExecutable);
        Assert.Equal(0.00004, options.Threshold);
        Assert.Null(options.SettingsOverlay);
    }

    [Fact]
    public void Options_parse_lists_and_values()
    {
        CaptureOptions options = new CaptureOptionsParser().Parse(
            ["--case", "Diego_v_alpha2_by_bessgeor, career-x", "--capture", "common", "--capture", "skills", "--threshold", "0.5", "--settings-overlay", "out/overlay"]);

        Assert.Equal(["Diego_v_alpha2_by_bessgeor", "career-x"], options.Cases);
        Assert.Equal(["common", "skills"], options.Captures);
        Assert.Equal(0.5, options.Threshold);
        Assert.Equal("out/overlay", options.SettingsOverlay);
    }

    [Theory]
    [InlineData("--unknown")]
    [InlineData("--case")]
    [InlineData("--threshold", "2")]
    [InlineData("--capture", "--case")]
    public void Invalid_options_are_rejected(params string[] args)
    {
        Assert.Throws<ArgumentException>(() => new CaptureOptionsParser().Parse(args));
    }

    [Fact]
    public void Execution_failure_wins_over_visual_results()
    {
        CaseRun failed = Run(canonicalFailure: "action 1: boom", passed: true);
        CaseRun visual = Run(canonicalFailure: null, passed: false);

        Assert.Equal(RunStatus.ExecutionFailures, CaptureRun.Status([failed, visual]));
        Assert.Equal(RunStatus.VisualDifferences, CaptureRun.Status([visual]));
        Assert.Equal(RunStatus.Passed, CaptureRun.Status([Run(canonicalFailure: null, passed: true)]));
        Assert.Equal(2, CaptureRun.ExitCode(RunStatus.ExecutionFailures));
        Assert.Equal(1, CaptureRun.ExitCode(RunStatus.VisualDifferences));
        Assert.Equal(0, CaptureRun.ExitCode(RunStatus.Passed));
        Assert.Equal(3, CaptureRun.ExitCode(RunStatus.SetupError));
    }

    [Fact]
    public void Unusable_runs_folder_is_a_setup_error()
    {
        string file = Path.GetTempFileName();
        try
        {
            using ServiceProvider services = Parity.Capture.Program.BuildServices();

            int exitCode = services.GetRequiredService<CaptureRun>().Execute(["--repo-root", RepositoryPaths.Root, "--runs-dir", file]);

            Assert.Equal(3, exitCode);
        }
        finally
        {
            File.Delete(file);
        }
    }

    [Fact]
    public void Summary_counts_outcomes_and_reads_back_strictly()
    {
        RunLayout layout = RunLayout.Create("runs", DateTimeOffset.UnixEpoch);
        RunReport report = new()
        {
            Layout = layout,
            Started = DateTimeOffset.UnixEpoch,
            Finished = DateTimeOffset.UnixEpoch.AddMinutes(1),
            Status = RunStatus.ExecutionFailures,
            CaseFile = "parity/cases/characters.json",
            Threshold = 0.00004,
            CanonicalSource = "bin/ChummerGenSR4.exe",
            CanonicalSourceSha256Before = CanonicalExecutableGuard.PinnedSha256,
            CanonicalSourceSha256After = CanonicalExecutableGuard.PinnedSha256,
            CanonicalStagedSha256After = CanonicalExecutableGuard.PinnedSha256,
            CandidateSource = "out/candidate/bin/ChummerGenSR4.exe",
            Screens = [],
            Cases = [Run(canonicalFailure: "action 1: boom", passed: true)],
        };
        ReportWriter writer = new();

        CaptureSummary summary = writer.BuildSummary(report, path => path);
        CaptureSummary readBack = ContractJson.ReadSummary(ContractJson.Write(summary));

        Assert.Equal(1, readBack.Totals.FailedSides);
        Assert.Equal(1, readBack.Totals.FailedActions);
        Assert.Equal(1, readBack.Totals.VisualPassed);
        SideExecution canonical = readBack.Cases[0].Sides[0];
        Assert.Equal(Status.Failed, canonical.Status);
        Assert.Equal("action 1: boom", canonical.Failure);
        Assert.Equal(1, canonical.Counts.Performed);
        Assert.Equal(1, canonical.Counts.Failed);
        Assert.Equal(ActionOutcome.Failed, canonical.Actions[1].Outcome);
        Assert.True(canonical.Actions[1].Optional);
        Assert.Equal("results.json", readBack.Results);
        Assert.Equal("1970-01-01T00:01:00.000Z", readBack.FinishedUtc);
    }

    private static CaseRun Run(string? canonicalFailure, bool passed)
    {
        ParityCase parityCase = new(
            "build-test",
            "test.chum",
            "test.chum",
            CharacterMode.Build,
            [new CaptureAction("common"), new SelectTabAction("Magic", Optional: true)]);
        SideRun canonical = new(
            RunLayout.CanonicalSide,
            [
                new ActionRecord(0, "capture:common", true, OutcomeKind.Performed, null),
                new ActionRecord(1, "selectTab:Magic", false, canonicalFailure is null ? OutcomeKind.OptionalAbsent : OutcomeKind.Failed, canonicalFailure),
            ],
            new Dictionary<string, string>(),
            canonicalFailure,
            TimeSpan.FromSeconds(1));
        SideRun candidate = canonical with
        {
            Side = RunLayout.CandidateSide,
            Actions =
            [
                new ActionRecord(0, "capture:common", true, OutcomeKind.Performed, null),
                new ActionRecord(1, "selectTab:Magic", false, OutcomeKind.OptionalAbsent, "No tab named 'Magic'."),
            ],
            Failure = null,
        };
        CaptureResult row = new()
        {
            Case = parityCase.Name,
            CharacterFile = parityCase.CharacterFile,
            Mode = Parity.Contracts.CaptureResults.Mode.Build,
            Capture = "common",
            Passed = passed,
            Reason = passed ? ResultReason.WithinThreshold : ResultReason.VisualDifference,
            Difference = passed ? 0 : 0.5,
        };
        return new CaseRun(parityCase, canonical, candidate, [row]);
    }
}
