using Parity.Capture.Cache;
using Parity.Capture.Execution;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureTiming;
using Parity.Contracts.UiTree;
using Parity.Tests.Fakes;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Tests;

public sealed class UiTreeRecordingTests : IDisposable
{
    private static readonly UiTiming Timing = new(TimeSpan.Zero, TimeSpan.Zero);

    private static readonly ParityCase Case = new(
        "build-test",
        "test.chum",
        "test.chum",
        CharacterMode.Build,
        [new CaptureAction("common"), new SelectTabAction("Skills", Optional: false), new CaptureAction("skills")]);

    private readonly string _root = Directory.CreateTempSubdirectory("parity-trees-").FullName;
    private readonly ScriptedUiDriver _driver = new();
    private readonly RunLayout _layout;

    public UiTreeRecordingTests()
    {
        _layout = new RunLayout("test-run", Path.Combine(_root, "run"));
        _driver.Tabs.Add("Skills");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void A_tree_is_written_right_after_each_capture()
    {
        SideRun run = RunSide(new SideExecutor(_driver), new UiTreeRecorder(_layout, Case.Name));

        Assert.False(run.Failed);
        Assert.Equal(["launch:app.exe", "capture", "tree", "selectTab:Skills", "capture", "tree"], _driver.Calls);
        UiTree tree = ContractJson.ReadUiTree(File.ReadAllText(Path.Combine(_root, "run", "ui-trees", "build-test", "skills.json")));
        Assert.Equal(("test-run", "build-test", "skills", Parity.Contracts.UiTree.Side.Candidate), (tree.RunId, tree.Case, tree.Capture, tree.Side));
        Assert.Equal(["frmMain", "cmdButton2"], tree.Nodes.Select(node => node.AutomationId));
        Assert.Equal([null, 0L], tree.Nodes.Select(node => node.Parent));
        Assert.True(File.Exists(Path.Combine(_root, "run", "ui-trees", "build-test", "common.json")));
    }

    [Fact]
    public void Without_a_recorder_no_tree_is_read()
    {
        SideRun run = RunSide(new SideExecutor(_driver), trees: null);

        Assert.False(run.Failed);
        Assert.DoesNotContain("tree", _driver.Calls);
        Assert.False(Directory.Exists(_layout.UiTrees));
    }

    [Fact]
    public void A_tree_that_cannot_be_read_fails_its_capture_action()
    {
        _driver.TreeFailure = new InvalidOperationException("scripted tree failure");

        SideRun run = RunSide(new SideExecutor(_driver), new UiTreeRecorder(_layout, Case.Name));

        Assert.True(run.Failed);
        Assert.Equal([OutcomeKind.Failed, OutcomeKind.NotRun, OutcomeKind.NotRun], run.Actions.Select(action => action.Outcome));
        Assert.Equal("InvalidOperationException: scripted tree failure", run.Actions[0].Reason);
        Assert.Empty(run.Captures);
        Assert.False(Directory.Exists(_layout.UiTrees));
        Assert.False(File.Exists(_layout.CapturePath(Case.Name, RunLayout.CandidateSide, "common")));
    }

    [Fact]
    public void A_filtered_capture_records_no_tree()
    {
        SideRun run = RunSide(new SideExecutor(_driver), new UiTreeRecorder(_layout, Case.Name), new HashSet<string>(["skills"]));

        Assert.False(run.Failed);
        Assert.Equal(["build-test/skills.json"], Directory.GetFiles(_layout.UiTrees, "*.json", SearchOption.AllDirectories)
            .Select(path => Path.GetRelativePath(_layout.UiTrees, path).Replace('\\', '/')));
    }

    [Fact]
    public void Only_the_candidate_side_records_trees()
    {
        StagedRun staged = new(
            Path.Combine(_root, "canonical.exe"),
            CanonicalExecutableGuard.PinnedSha256,
            Path.Combine(_root, "candidate.exe"),
            new string('1', 64),
            null,
            new Dictionary<string, string> { [Case.Name] = Path.Combine(_root, "test.chum") });
        FileHasher hasher = new();
        CaseRunner runner = new(
            new SideExecutor(_driver),
            new VisualResultBuilder(new PixelComparer()),
            new TimingRecorder(),
            new CacheKeyBuilder(hasher),
            new CanonicalCaptureCache(hasher));

        CaseRun run = runner.Run(Case, _layout, staged, Timing, null, 0.00004, null, uiTrees: true);

        Assert.False(run.Canonical.Failed || run.Candidate.Failed);
        Assert.Equal(
            ["launch:canonical.exe", "capture", "selectTab:Skills", "capture", "launch:candidate.exe", "capture", "tree", "selectTab:Skills", "capture", "tree"],
            _driver.Calls);
        Assert.Equal(2, Directory.GetFiles(_layout.UiTrees, "*.json", SearchOption.AllDirectories).Length);
    }

    [Fact]
    public void Recording_a_tree_is_timed()
    {
        TimingRecorder recorder = new();
        TimedUiDriver driver = new(_driver, recorder, new SteppingTimeProvider());

        using (recorder.BeginSide(Case.Name, RunLayout.CandidateSide))
        {
            RunSide(new SideExecutor(driver), new UiTreeRecorder(_layout, Case.Name));
        }

        CaptureTiming timing = recorder.Build("test-run");
        SideTiming side = Assert.Single(timing.Sides);
        Assert.Equal(
            [Operation.Launch, Operation.Activate, Operation.Capture, Operation.UiTree, Operation.Activate, Operation.SelectTab, Operation.Activate, Operation.Capture, Operation.UiTree, Operation.Close],
            side.Samples.Select(sample => sample.Operation));
        Assert.Equal(
            [Operation.Launch, Operation.Activate, Operation.SelectTab, Operation.Capture, Operation.UiTree, Operation.Close],
            timing.Operations.Select(operation => operation.Operation));
        Assert.Equal((2, 0), (timing.Operations[4].Count, timing.Operations[4].Failures));
    }

    private SideRun RunSide(SideExecutor executor, UiTreeRecorder? trees, IReadOnlySet<string>? filter = null) =>
        executor.Run(
            RunLayout.CandidateSide,
            Path.Combine(_root, "app.exe"),
            Case,
            Path.Combine(_root, "test.chum"),
            Timing,
            filter,
            capture => _layout.CapturePath(Case.Name, RunLayout.CandidateSide, capture),
            trees);
}
