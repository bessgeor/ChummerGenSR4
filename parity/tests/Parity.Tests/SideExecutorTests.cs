using Parity.Capture.Execution;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Tests.Fakes;

namespace Parity.Tests;

public sealed class SideExecutorTests : IDisposable
{
    private static readonly UiTiming Timing = new(TimeSpan.Zero, TimeSpan.Zero);

    private readonly string _directory = Directory.CreateTempSubdirectory("parity-side-").FullName;
    private readonly ScriptedUiDriver _driver = new();

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Every_action_performs_and_captures_are_written()
    {
        _driver.Tabs.Add("Skills");

        SideRun run = Run(Case(
            new CaptureAction("common"),
            new SelectTabAction("Skills", Optional: false),
            new WaitForAction("Active Skills"),
            new WaitAction(5),
            new CaptureAction("skills")));

        Assert.False(run.Failed);
        Assert.All(run.Actions, action => Assert.Equal(OutcomeKind.Performed, action.Outcome));
        Assert.Equal([0, 1, 2, 3, 4], run.Actions.Select(action => action.Index));
        Assert.Equal(["common", "skills"], run.Captures.Keys.Order());
        Assert.True(File.Exists(run.Captures["skills"]));
        Assert.True(_driver.Disposed);
    }

    [Fact]
    public void Rich_actions_reach_the_session_in_order()
    {
        SideRun run = Run(Case(
            new CaptureAction("before"),
            new SetValueAction("txtCharacterName", "Example"),
            new SelectItemAction("treGear", "Commlink"),
            new ContextMenuAction("treGear", "Add as Plugin"),
            new ClickAction("cmdCancel"),
            new CaptureAction("after")));

        Assert.False(run.Failed);
        Assert.All(run.Actions, action => Assert.Equal(OutcomeKind.Performed, action.Outcome));
        Assert.Equal(
            ["capture", "setValue:txtCharacterName=Example", "selectItem:treGear=Commlink", "contextMenu:treGear=Add as Plugin", "click:cmdCancel", "capture"],
            _driver.Calls.Skip(1));
    }

    [Fact]
    public void Failed_rich_action_stops_the_side()
    {
        _driver.MissingControls.Add("cmdAddGear");

        SideRun run = Run(Case(new ClickAction("cmdAddGear"), new CaptureAction("dialog")));

        Assert.True(run.Failed);
        Assert.Equal([OutcomeKind.Failed, OutcomeKind.NotRun], run.Actions.Select(action => action.Outcome));
        Assert.Equal("InvalidOperationException: No enabled control 'cmdAddGear' is on screen.", run.Actions[0].Reason);
        Assert.Equal("action 0 (click:cmdAddGear): InvalidOperationException: No enabled control 'cmdAddGear' is on screen.", run.Failure);
    }

    [Fact]
    public void Absent_optional_tab_skips_its_wait_and_capture_but_not_the_next_tab()
    {
        _driver.Tabs.Add("Cyberware and Bioware");

        SideRun run = Run(Case(
            new SelectTabAction("Adept Powers", Optional: true),
            new WaitForAction("Power Points:"),
            new CaptureAction("adept-powers"),
            new SelectTabAction("Cyberware and Bioware", Optional: false),
            new WaitForAction("Selected Cyberware"),
            new CaptureAction("cyberware")));

        Assert.False(run.Failed);
        Assert.Equal(
            [OutcomeKind.OptionalAbsent, OutcomeKind.SkippedOptional, OutcomeKind.SkippedOptional, OutcomeKind.Performed, OutcomeKind.Performed, OutcomeKind.Performed],
            run.Actions.Select(action => action.Outcome));
        Assert.False(run.Actions[0].Required);
        Assert.Equal("optional tab 'Adept Powers' is absent", run.Actions[2].Reason);
        Assert.DoesNotContain("waitFor:Power Points:", _driver.Calls);
        Assert.Equal(["cyberware"], run.Captures.Keys);
    }

    [Fact]
    public void Absent_required_tab_fails_and_stops_the_side()
    {
        SideRun run = Run(Case(
            new CaptureAction("common"),
            new SelectTabAction("Skills", Optional: false),
            new WaitForAction("Active Skills"),
            new CaptureAction("skills")));

        Assert.True(run.Failed);
        Assert.Equal([OutcomeKind.Performed, OutcomeKind.Failed, OutcomeKind.NotRun, OutcomeKind.NotRun], run.Actions.Select(action => action.Outcome));
        Assert.StartsWith("TabNotFoundException: No tab named 'Skills'", run.Actions[1].Reason);
        Assert.StartsWith("action 1 (selectTab:Skills): ", run.Failure);
        Assert.True(_driver.Disposed);
    }

    [Fact]
    public void Label_timeout_fails_and_later_actions_do_not_run()
    {
        _driver.Tabs.Add("Skills");
        _driver.MissingLabels.Add("Active Skills");

        SideRun run = Run(Case(
            new SelectTabAction("Skills", Optional: false),
            new WaitForAction("Active Skills"),
            new CaptureAction("skills"),
            new SelectTabAction("Skills", Optional: false)));

        Assert.Equal([OutcomeKind.Performed, OutcomeKind.Failed, OutcomeKind.NotRun, OutcomeKind.NotRun], run.Actions.Select(action => action.Outcome));
        Assert.Empty(run.Captures);
        Assert.Equal(OutcomeKind.NotRun, run.CaptureOutcome("skills"));
    }

    [Fact]
    public void Window_activation_failure_keeps_its_reason()
    {
        _driver.Tabs.Add("Skills");
        _driver.ActivationFailuresBeforeCapture = 0;

        SideRun run = Run(Case(
            new SelectTabAction("Skills", Optional: false),
            new WaitForAction("Active Skills"),
            new CaptureAction("skills")));

        Assert.Equal(OutcomeKind.Failed, run.Actions[2].Outcome);
        Assert.StartsWith("window-activation: ", run.Actions[2].Reason);
    }

    [Fact]
    public void Pointer_moved_before_a_capture_fails_it_with_its_reason()
    {
        _driver.PointerMovedBeforeCapture = true;

        SideRun run = Run(Case(new CaptureAction("common"), new WaitAction(10)));

        Assert.Equal([OutcomeKind.Failed, OutcomeKind.NotRun], run.Actions.Select(action => action.Outcome));
        Assert.Equal("pointer: scripted pointer move", run.Actions[0].Reason);
        Assert.Empty(run.Captures);
    }

    [Fact]
    public void Startup_failure_marks_every_action_not_run()
    {
        _driver.LaunchFailure = new TimeoutException("no window");

        SideRun run = Run(Case(new CaptureAction("common"), new SelectTabAction("Skills", Optional: false)));

        Assert.True(run.Failed);
        Assert.Equal("startup: TimeoutException: no window", run.Failure);
        Assert.All(run.Actions, action => Assert.Equal(OutcomeKind.NotRun, action.Outcome));
    }

    [Fact]
    public void Capture_filter_marks_other_captures_filtered_but_runs_navigation()
    {
        _driver.Tabs.Add("Skills");

        SideRun run = Run(
            Case(new CaptureAction("common"), new SelectTabAction("Skills", Optional: false), new CaptureAction("skills")),
            new HashSet<string>(["skills"], StringComparer.Ordinal));

        Assert.Equal([OutcomeKind.Filtered, OutcomeKind.Performed, OutcomeKind.Performed], run.Actions.Select(action => action.Outcome));
        Assert.Equal(["skills"], run.Captures.Keys);
        Assert.Contains("selectTab:Skills", _driver.Calls);
    }

    [Fact]
    public void Capture_filter_marks_a_capture_filtered_even_when_its_optional_tab_is_absent()
    {
        SideRun run = Run(
            Case(new CaptureAction("common"), new SelectTabAction("Adept Powers", Optional: true), new WaitForAction("Power Points:"), new CaptureAction("adept-powers")),
            new HashSet<string>(["common"], StringComparer.Ordinal));

        Assert.Equal([OutcomeKind.Performed, OutcomeKind.OptionalAbsent, OutcomeKind.SkippedOptional, OutcomeKind.Filtered], run.Actions.Select(action => action.Outcome));
    }

    private SideRun Run(ParityCase parityCase, IReadOnlySet<string>? filter = null) =>
        new SideExecutor(_driver).Run(
            "canonical",
            Path.Combine(_directory, "app.exe"),
            parityCase,
            Path.Combine(_directory, "character.chum"),
            Timing,
            filter,
            capture => Path.Combine(_directory, "captures", $"{capture}.png"));

    private static ParityCase Case(params ParityAction[] actions) =>
        new("build-test", "test.chum", "test.chum", CharacterMode.Build, actions);
}
