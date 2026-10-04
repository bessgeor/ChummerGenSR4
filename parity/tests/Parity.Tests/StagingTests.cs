using System.Text.RegularExpressions;
using Parity.Capture.Staging;
using Parity.Cases;

namespace Parity.Tests;

/// <summary>Staging reads the real canonical <c>bin/</c> (never writes it) and stages into a temporary run folder.</summary>
public sealed class StagingTests : IDisposable
{
    private static readonly string CanonicalExecutable = Path.Combine(RepositoryPaths.Root, "bin", "ChummerGenSR4.exe");

    private readonly string _directory = Directory.CreateTempSubdirectory("parity-staging-").FullName;
    private readonly FileHasher _hasher = new();

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Guard_accepts_the_canonical_executable()
    {
        Assert.Equal(CanonicalExecutableGuard.PinnedSha256, new CanonicalExecutableGuard(_hasher).Verify(CanonicalExecutable, "canonical executable"));
    }

    [Theory]
    [InlineData("AGENTS.md")]
    [InlineData("parity/scripts/build-candidate.mjs")]
    public void Every_copy_of_the_pinned_hash_is_the_same(string file)
    {
        string text = File.ReadAllText(Path.Combine(RepositoryPaths.Root, file));

        Assert.Equal(
            [CanonicalExecutableGuard.PinnedSha256],
            Regex.Matches(text, "\\b[0-9a-f]{64}\\b").Select(match => match.Value).Distinct());
    }

    [Fact]
    public void Guard_rejects_any_other_file()
    {
        string other = Path.Combine(_directory, "ChummerGenSR4.exe");
        File.WriteAllText(other, "not the canonical build");

        SetupException error = Assert.Throws<SetupException>(() => new CanonicalExecutableGuard(_hasher).Verify(other, "canonical executable"));
        Assert.Contains("expected the canonical", error.Message);
    }

    [Fact]
    public void Stage_copies_both_apps_with_canonical_support_files_and_the_fixtures()
    {
        RunLayout layout = Layout();
        string candidate = Candidate();
        ParityCase parityCase = FixtureCase();

        StagedRun staged = Stager().Stage(layout, RepositoryPaths.Root, CanonicalExecutable, candidate, null, [parityCase]);

        Assert.Equal(CanonicalExecutableGuard.PinnedSha256, staged.CanonicalSha256);
        Assert.Equal(_hasher.Sha256(candidate), staged.CandidateSha256);
        Assert.Null(staged.Overlay);
        foreach (string app in new[] { layout.CanonicalApp, layout.CandidateApp })
        {
            Assert.True(File.Exists(Path.Combine(app, "ChummerGenSR4.exe")));
            Assert.All(RunStager.SupportFolders, folder => Assert.True(Directory.Exists(Path.Combine(app, folder)), folder));
            Assert.Equal(
                File.ReadAllBytes(Path.Combine(RepositoryPaths.Root, "bin", "settings", "default.xml")),
                File.ReadAllBytes(Path.Combine(app, "settings", "default.xml")));
        }

        Assert.True(File.Exists(Path.Combine(layout.CandidateApp, "helper.dll")));
        CharacterCopy copy = staged.CharacterCopies[parityCase.Name];
        Assert.Equal(copy.Canonical, copy.Candidate);
        Assert.Equal(File.ReadAllBytes(parityCase.CharacterPath), File.ReadAllBytes(copy.Canonical));
        Assert.StartsWith(layout.Characters, copy.Canonical);
    }

    [Fact]
    public void A_case_that_saves_gets_a_copy_per_side()
    {
        ParityCase reading = FixtureCase();
        ParityCase saving = reading with { Name = $"{reading.Name}@round-trip", Actions = [new SaveReloadAction(), new CaptureAction("reloaded")] };
        RunLayout layout = Layout();

        StagedRun staged = Stager().Stage(layout, RepositoryPaths.Root, CanonicalExecutable, Candidate(), null, [reading, saving]);

        CharacterCopy copy = staged.CharacterCopies[saving.Name];
        Assert.Equal(layout.CharacterCopy(saving.Name, RunLayout.CanonicalSide, saving.CharacterFile), copy.Canonical);
        Assert.Equal(layout.CharacterCopy(saving.Name, RunLayout.CandidateSide, saving.CharacterFile), copy.Candidate);
        Assert.All([copy.Canonical, copy.Candidate], path => Assert.Equal(File.ReadAllBytes(saving.CharacterPath), File.ReadAllBytes(path)));
        Assert.Equal(staged.CharacterCopies[reading.Name].Canonical, staged.CharacterCopies[reading.Name].Candidate);
        Assert.True(saving.Saves);
        Assert.False(reading.Saves);
    }

    [Fact]
    public void Overlay_replaces_staged_settings_only()
    {
        string overlay = Path.Combine(_directory, "overlay");
        Directory.CreateDirectory(Path.Combine(overlay, "settings"));
        File.WriteAllText(Path.Combine(overlay, "settings", "default.xml"), "<settings />");
        File.WriteAllText(Path.Combine(overlay, "settings", "extra.xml"), "<settings />");
        byte[] repositorySettings = File.ReadAllBytes(Path.Combine(RepositoryPaths.Root, "bin", "settings", "default.xml"));
        RunLayout layout = Layout();

        StagedRun staged = Stager().Stage(layout, RepositoryPaths.Root, CanonicalExecutable, Candidate(), overlay, [FixtureCase()]);

        Assert.NotNull(staged.Overlay);
        Assert.Equal(
            [("settings/default.xml", true), ("settings/extra.xml", false)],
            staged.Overlay.Select(file => (file.RelativePath, file.Replaced)));
        Assert.Equal(_hasher.Sha256(Path.Combine(overlay, "settings", "default.xml")), staged.Overlay[0].Sha256);
        Assert.Equal("<settings />", File.ReadAllText(Path.Combine(layout.CanonicalApp, "settings", "default.xml")));
        Assert.Equal("<settings />", File.ReadAllText(Path.Combine(layout.CandidateApp, "settings", "default.xml")));
        Assert.Equal(repositorySettings, File.ReadAllBytes(Path.Combine(RepositoryPaths.Root, "bin", "settings", "default.xml")));
    }

    [Fact]
    public void Overlay_that_replaces_the_executable_fails_the_canonical_check()
    {
        string overlay = Path.Combine(_directory, "overlay");
        Directory.CreateDirectory(overlay);
        File.WriteAllText(Path.Combine(overlay, "ChummerGenSR4.exe"), "not the canonical build");

        SetupException error = Assert.Throws<SetupException>(
            () => Stager().Stage(Layout(), RepositoryPaths.Root, CanonicalExecutable, Candidate(), overlay, [FixtureCase()]));
        Assert.Contains("staged canonical executable", error.Message);
    }

    [Fact]
    public void Fixtures_with_the_same_file_name_are_staged_apart()
    {
        ParityCase build = FixtureCase();
        ParityCase career = build with { Name = "career-Diego_v_alpha2_by_bessgeor", Mode = CharacterMode.Career };

        StagedRun staged = Stager().Stage(Layout(), RepositoryPaths.Root, CanonicalExecutable, Candidate(), null, [build, career]);

        Assert.NotEqual(staged.CharacterCopies[build.Name].Canonical, staged.CharacterCopies[career.Name].Canonical);
        Assert.All(staged.CharacterCopies.Values, copy => Assert.Equal(build.CharacterFile, Path.GetFileName(copy.Canonical)));
        Assert.All(staged.CharacterCopies.Values, copy => Assert.True(File.Exists(copy.Canonical)));
    }

    [Fact]
    public void Overlay_inside_the_repository_outside_out_is_rejected()
    {
        string trackedFolder = Path.Combine(RepositoryPaths.Root, "bin", "settings");

        SetupException error = Assert.Throws<SetupException>(
            () => Stager().Stage(Layout(), RepositoryPaths.Root, CanonicalExecutable, Candidate(), trackedFolder, [FixtureCase()]));
        Assert.Contains("outside the repository or under out/", error.Message);
    }

    [Fact]
    public void Missing_candidate_is_a_setup_error()
    {
        SetupException error = Assert.Throws<SetupException>(
            () => Stager().Stage(Layout(), RepositoryPaths.Root, CanonicalExecutable, Path.Combine(_directory, "none.exe"), null, [FixtureCase()]));
        Assert.Contains("npm run build:candidate", error.Message);
    }

    [Fact]
    public void Capture_paths_are_inside_the_run_and_relative_paths_use_slashes()
    {
        RunLayout layout = Layout();
        string path = layout.CapturePath("career-Шпала - карьера", RunLayout.CandidateSide, "street-gear-armor");

        Assert.Equal("captures/career-Шпала - карьера/candidate/street-gear-armor.png", layout.Relative(path));
    }

    private RunLayout Layout() => RunLayout.Create(Path.Combine(_directory, "runs"), DateTimeOffset.UnixEpoch);

    private RunStager Stager() => new(_hasher, new CanonicalExecutableGuard(_hasher), new SettingsOverlayApplier(_hasher));

    private string Candidate()
    {
        string folder = Path.Combine(_directory, "candidate");
        Directory.CreateDirectory(folder);
        File.WriteAllText(Path.Combine(folder, "ChummerGenSR4.exe"), "candidate build");
        File.WriteAllText(Path.Combine(folder, "helper.dll"), "dependency");
        return Path.Combine(folder, "ChummerGenSR4.exe");
    }

    private static ParityCase FixtureCase()
    {
        string path = Path.Combine(RepositoryPaths.Fixtures, "Diego_v_alpha2_by_bessgeor.chum");
        return new ParityCase("build-Diego_v_alpha2_by_bessgeor", Path.GetFileName(path), path, CharacterMode.Build, [new CaptureAction("common")]);
    }
}
