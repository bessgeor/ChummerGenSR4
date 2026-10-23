using System.Text.Json.Nodes;
using Parity.Capture.Cache;
using Parity.Capture.Execution;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.CaptureSummary;
using Parity.Tests.Fakes;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Tests;

public sealed class CanonicalCaptureCacheTests : IDisposable
{
    private static readonly UiTiming Timing = new(TimeSpan.FromSeconds(3), TimeSpan.FromMilliseconds(300));
    private static readonly string Pinned = CanonicalExecutableGuard.PinnedSha256;

    private readonly string _root = Directory.CreateTempSubdirectory("parity-cache-").FullName;
    private readonly ScriptedUiDriver _driver = new();
    private readonly FileHasher _hasher = new();
    private readonly ParityCase _case;
    private readonly CacheSession _session;

    public CanonicalCaptureCacheTests()
    {
        string character = Path.Combine(_root, "fixtures", "test.chum");
        Directory.CreateDirectory(Path.GetDirectoryName(character)!);
        File.WriteAllText(character, "<character />");
        _case = Case(character, new CaptureAction("common"), new SelectTabAction("Skills", Optional: false), new CaptureAction("skills"));
        _session = new CacheSession(Path.Combine(_root, "cache"), "app-fingerprint", new CacheEnvironment(["dpi:144", "os:test"]));
        Directory.CreateDirectory(_session.Directory);
        _driver.Tabs.Add("Skills");
    }

    public void Dispose() => Directory.Delete(_root, recursive: true);

    [Fact]
    public void Key_is_stable_and_changes_with_every_input()
    {
        CacheKeyBuilder builder = new(_hasher);
        string baseline = builder.Build(_session, Pinned, _case, null, Timing).Value;
        Assert.Equal(baseline, builder.Build(_session, Pinned, _case, null, Timing).Value);

        string otherCharacter = Path.Combine(_root, "fixtures", "other.chum");
        File.WriteAllText(otherCharacter, "<character created=\"True\" />");
        string[] variants =
        [
            builder.Build(_session, new string('0', 64), _case, null, Timing).Value,
            builder.Build(new CacheSession(_session.Directory, "other-fingerprint", _session.Environment), Pinned, _case, null, Timing).Value,
            builder.Build(new CacheSession(_session.Directory, _session.AppFingerprint, new CacheEnvironment(["dpi:96", "os:test"])), Pinned, _case, null, Timing).Value,
            builder.Build(_session, Pinned, _case with { CharacterPath = otherCharacter }, null, Timing).Value,
            builder.Build(_session, Pinned, _case with { Name = "build-other" }, null, Timing).Value,
            builder.Build(_session, Pinned, _case with { Mode = CharacterMode.Career }, null, Timing).Value,
            builder.Build(_session, Pinned, _case with { Actions = [.. _case.Actions.Reverse()] }, null, Timing).Value,
            builder.Build(_session, Pinned, _case with { Actions = [new CaptureAction("common"), new SelectTabAction("Skills", Optional: true), new CaptureAction("skills")] }, null, Timing).Value,
            builder.Build(_session, Pinned, _case, new HashSet<string>(["skills"]), Timing).Value,
            builder.Build(_session, Pinned, _case, null, Timing with { Settle = TimeSpan.FromMilliseconds(301) }).Value,
            builder.Build(_session, Pinned, _case, null, Timing with { StartupDelay = TimeSpan.FromSeconds(4) }).Value,
        ];

        Assert.DoesNotContain(baseline, variants);
        Assert.Equal(variants.Length, variants.Distinct().Count());
    }

    [Fact]
    public void Environment_lists_screens_scale_os_colours_options_cultures_and_runner_assemblies()
    {
        ScreenRect rect = new() { X = 0, Y = 0, Width = 1920, Height = 1080 };
        ScreenInfo[] screens = [new ScreenInfo { DeviceName = "DISPLAY1", Primary = true, Bounds = rect, WorkingArea = rect }];
        CacheEnvironment environment = new CacheEnvironmentReader(_hasher).Read(screens);

        Assert.Equal("screen:DISPLAY1:primary:0,0,1920x1080:0,0,1920x1080", environment.Lines[0]);
        Assert.Matches(@"^monitor-dpi:DISPLAY1:\d+x\d+$", environment.Lines[1]);
        Assert.StartsWith("dpi:", environment.Lines[2]);
        Assert.StartsWith("os:", environment.Lines[3]);
        Assert.Matches(@"^os-patch:\d+\.\d+$", environment.Lines[4]);
        Assert.StartsWith("culture:", environment.Lines[5]);
        Assert.Contains(environment.Lines, line => line.StartsWith("dwm:", StringComparison.Ordinal));
        Assert.Contains(environment.Lines, line => line.StartsWith("personalize:", StringComparison.Ordinal));
        foreach (string prefix in new[] { "system-colour:", "desktop:", "window-metric:", "text-scale:", "high-contrast:" })
        {
            Assert.Contains(environment.Lines, line => line.StartsWith(prefix, StringComparison.Ordinal));
        }
        Assert.Contains(environment.Lines, line => line.StartsWith("app-option:", StringComparison.Ordinal));
        Assert.Contains(environment.Lines, line => line.StartsWith("runner:Parity.Capture.dll:", StringComparison.Ordinal));
        Assert.Equal(environment.Lines, new CacheEnvironmentReader(_hasher).Read(screens).Lines);
    }

    [Theory]
    [InlineData("language", true)]
    [InlineData("startupfullscreen", true)]
    [InlineData("defaultsheet", true)]
    [InlineData("mru1", false)]
    [InlineData("stickymru2", false)]
    [InlineData("omaeusername", false)]
    [InlineData("omaepassword", false)]
    public void App_options_in_the_key_leave_out_recent_files_and_the_omae_account(string name, bool inKey) =>
        Assert.Equal(inKey, CacheEnvironmentReader.IsAppOption(name));

    [Fact]
    public void Runner_assemblies_do_not_embed_the_commit()
    {
        foreach (Type type in new[] { typeof(CaseRunner), typeof(ParityCase), typeof(Parity.Imaging.ArgbImage) })
        {
            string? version = System.Reflection.CustomAttributeExtensions
                .GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>(type.Assembly)?.InformationalVersion;
            Assert.DoesNotContain("+", version);
        }
    }

    [Fact]
    public void Miss_runs_live_and_stores_then_a_hit_restores_without_launching()
    {
        CaseRun first = Run("first");

        Assert.False(first.Canonical.Origin.FromCache);
        Assert.NotNull(first.Canonical.Origin.CacheKey);
        Assert.Equal((0, 1, 1), (_session.Hits, _session.Misses, _session.Stored));
        Assert.Equal(2, _driver.Calls.Count(call => call.StartsWith("launch:", StringComparison.Ordinal)));

        _driver.Calls.Clear();
        CaseRun second = Run("second");

        Assert.Equal(["launch:candidate.exe"], _driver.Calls.Where(call => call.StartsWith("launch:", StringComparison.Ordinal)));
        Assert.True(second.Canonical.Origin.FromCache);
        Assert.Equal(first.Canonical.Origin.CacheKey, second.Canonical.Origin.CacheKey);
        Assert.Equal(64, first.Canonical.Origin.CacheKey!.Length);
        Assert.StartsWith("first-", second.Canonical.Origin.CachedFromRun);
        Assert.Equal(first.Canonical.Actions, second.Canonical.Actions);
        Assert.Equal(["common", "skills"], second.Canonical.Captures.Keys.Order());
        Assert.All(second.Canonical.Captures.Values, path => Assert.StartsWith(Path.Combine(_root, "runs", "second-"), path));
        Assert.Equal(_hasher.Sha256(first.Canonical.Captures["skills"]), _hasher.Sha256(second.Canonical.Captures["skills"]));
        Assert.All(second.Results, row => Assert.True(row.Passed));
        Assert.Equal((1, 1, 1), (_session.Hits, _session.Misses, _session.Stored));
    }

    [Fact]
    public void Corrupted_capture_fails_the_restore()
    {
        CaseRun first = Run("first");
        string entry = Path.Combine(_session.Directory, first.Canonical.Origin.CacheKey!);
        File.AppendAllText(Path.Combine(entry, "capture-1.png"), "x");

        SetupException error = Assert.Throws<SetupException>(() => Run("second"));

        Assert.Contains("is corrupted", error.Message);
        Assert.Contains(entry, error.Message);
    }

    [Fact]
    public void Unreadable_entry_fails_the_restore()
    {
        CaseRun first = Run("first");
        File.WriteAllText(Path.Combine(_session.Directory, first.Canonical.Origin.CacheKey!, CanonicalCaptureCache.EntryFileName), "{ not json");

        SetupException error = Assert.Throws<SetupException>(() => Run("second"));

        Assert.Contains("cannot be read", error.Message);
    }

    [Fact]
    public void Missing_capture_file_fails_the_restore()
    {
        CaseRun first = Run("first");
        File.Delete(Path.Combine(_session.Directory, first.Canonical.Origin.CacheKey!, "capture-2.png"));

        Assert.Throws<SetupException>(() => Run("second"));
    }

    [Fact]
    public void Failed_side_is_not_stored()
    {
        _driver.Tabs.Clear();

        CaseRun run = Run("first");

        Assert.True(run.Canonical.Failed);
        Assert.Equal((0, 1, 0), (_session.Hits, _session.Misses, _session.Stored));
        Assert.Empty(Directory.EnumerateFileSystemEntries(_session.Directory));
    }

    [Fact]
    public void Completed_side_is_stored_only_when_the_run_stores_its_pending_sides()
    {
        Run("first", commit: false);

        Assert.Equal((0, 1, 0), (_session.Hits, _session.Misses, _session.Stored));
        Assert.Single(_session.Pending);
        Assert.Empty(Directory.EnumerateFileSystemEntries(_session.Directory));

        new CanonicalCaptureCache(_hasher).StorePending(_session);

        Assert.Equal((0, 1, 1), (_session.Hits, _session.Misses, _session.Stored));
        Assert.Empty(_session.Pending);
        Assert.Single(Directory.EnumerateDirectories(_session.Directory));
    }

    [Fact]
    public void Existing_entry_is_never_replaced()
    {
        CaseRun first = Run("first");
        CanonicalCaptureCache cache = new(_hasher);
        CacheKey key = new CacheKeyBuilder(_hasher).Build(_session, Pinned, _case, null, Timing);
        string entryFile = Path.Combine(_session.Directory, key.Value, CanonicalCaptureCache.EntryFileName);
        string before = File.ReadAllText(entryFile);

        bool stored = cache.Store(_session, key, "another-run", first.Canonical);

        Assert.False(stored);
        Assert.Equal(before, File.ReadAllText(entryFile));
        Assert.Equal("first", JsonNode.Parse(before)!["runId"]!.GetValue<string>()[..5]);
        Assert.Single(Directory.EnumerateDirectories(_session.Directory));
    }

    [Theory]
    [InlineData("parity", false)]
    [InlineData("out/canonical-cache", true)]
    public void Cache_folder_must_be_uncommittable(string relative, bool allowed)
    {
        string repository = Path.Combine(_root, "repo");
        void Ensure() => UncommittableLocation.Ensure(repository, Path.Combine(repository, relative), "canonical capture cache");

        if (allowed)
        {
            Ensure();
        }
        else
        {
            Assert.Contains("canonical capture cache", Assert.Throws<SetupException>(Ensure).Message);
        }

        UncommittableLocation.Ensure(repository, Path.Combine(_root, "elsewhere"), "canonical capture cache");
    }

    [Fact]
    public void Option_selects_the_cache_folder()
    {
        Assert.Null(new CaptureOptionsParser().Parse([]).CanonicalCache);
        Assert.Equal("out/cache", new CaptureOptionsParser().Parse(["--canonical-cache", "out/cache"]).CanonicalCache);
        Assert.Throws<ArgumentException>(() => new CaptureOptionsParser().Parse(["--canonical-cache"]));
    }

    [Fact]
    public void Summary_records_the_sources_and_the_cache()
    {
        Run("first");
        CaseRun second = Run("second");
        RunReport report = new()
        {
            Layout = RunLayout.Create(Path.Combine(_root, "runs"), DateTimeOffset.UnixEpoch),
            Started = DateTimeOffset.UnixEpoch,
            Finished = DateTimeOffset.UnixEpoch,
            Status = RunStatus.Passed,
            CaseFile = "parity/cases/characters.json",
            Threshold = 0.00004,
            CanonicalSource = "bin/ChummerGenSR4.exe",
            CanonicalSourceSha256Before = Pinned,
            CandidateSource = "out/candidate/bin/ChummerGenSR4.exe",
            UiTrees = false,
            Cache = _session,
            Screens = [],
            Cases = [second],
        };

        CaptureSummary summary = ContractJson.ReadSummary(ContractJson.Write(new ReportWriter().BuildSummary(report, path => path)));

        SideExecution canonical = summary.Cases[0].Sides[0];
        Assert.Equal(Source.Cache, canonical.Source);
        Assert.Equal(second.Canonical.Origin.CacheKey, canonical.CacheEntry);
        Assert.StartsWith("first-", canonical.CachedFromRun);
        SideExecution candidate = summary.Cases[0].Sides[1];
        Assert.Equal(Source.Live, candidate.Source);
        Assert.Null(candidate.CacheEntry);
        Assert.Equal((1L, 1L, 1L), (summary.CanonicalCache!.Hits, summary.CanonicalCache.Misses, summary.CanonicalCache.Stored));
        Assert.Equal(_session.Directory, summary.CanonicalCache.Path);
    }

    private CaseRun Run(string runName, bool commit = true)
    {
        RunLayout layout = new($"{runName}-{Guid.NewGuid():N}", Path.Combine(_root, "runs", $"{runName}-{Guid.NewGuid():N}"));
        StagedRun staged = new(
            Path.Combine(_root, "canonical.exe"),
            Pinned,
            Path.Combine(_root, "candidate.exe"),
            new string('1', 64),
            null,
            new Dictionary<string, CharacterCopy> { [_case.Name] = new(_case.CharacterPath, _case.CharacterPath) });
        CaseRunner runner = new(
            new SideExecutor(_driver),
            new VisualResultBuilder(new PixelComparer()),
            new TimingRecorder(),
            new CacheKeyBuilder(_hasher),
            new CanonicalCaptureCache(_hasher));
        CaseRun run = runner.Run(_case, layout, staged, Timing, null, 0.00004, _session, uiTrees: false);
        if (commit)
        {
            new CanonicalCaptureCache(_hasher).StorePending(_session);
        }

        return run;
    }

    private static ParityCase Case(string characterPath, params ParityAction[] actions) =>
        new("build-test", "test.chum", characterPath, CharacterMode.Build, actions);
}
