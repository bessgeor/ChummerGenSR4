using System.Text.Json.Nodes;
using Parity.Cases;

namespace Parity.Tests;

public sealed class CaseFileLoaderTests : IDisposable
{
    private const string BuildFixture = "Diego_v_alpha2_by_bessgeor.chum";
    private const string CareerFixture = "Шпала - карьера.chum";

    private readonly string _directory = Directory.CreateTempSubdirectory("parity-cases-").FullName;
    private readonly CaseFileLoader _loader = new(new ActionExpander(), new CharacterModeReader());

    public void Dispose() => Directory.Delete(_directory, recursive: true);

    [Fact]
    public void Repository_case_file_loads_both_fixtures()
    {
        CaseSuite suite = _loader.Load(RepositoryPaths.CaseFile);

        Assert.Equal(3, suite.StartupDelaySeconds);
        Assert.Equal(300, suite.SettleMilliseconds);
        Assert.Collection(
            suite.Cases,
            build =>
            {
                Assert.Equal("build-Diego_v_alpha2_by_bessgeor", build.Name);
                Assert.Equal(CharacterMode.Build, build.Mode);
                Assert.Equal(46, build.Actions.Count);
                Assert.Equal(16, build.Actions.OfType<CaptureAction>().Count());
            },
            career =>
            {
                Assert.Equal("career-Шпала - карьера", career.Name);
                Assert.Equal(CharacterMode.Career, career.Mode);
                Assert.Equal(67, career.Actions.Count);
                Assert.Equal(23, career.Actions.OfType<CaptureAction>().Count());
            });
    }

    [Fact]
    public void Includes_expand_in_order_and_optional_marks_the_tab_only()
    {
        CaseSuite suite = _loader.Load(RepositoryPaths.CaseFile);
        IReadOnlyList<ParityAction> actions = suite.Cases[0].Actions;

        Assert.Equal(new CaptureAction("common"), actions[0]);
        Assert.Equal(new SelectTabAction("Skills", Optional: false), actions[1]);
        Assert.Equal(new SelectTabAction("Spells and Spirits", Optional: true), actions[7]);
        Assert.False(actions[7].Required);
        Assert.True(actions[8].Required);
        Assert.Equal("selectTab:Spells and Spirits", actions[7].Describe());
    }

    [Fact]
    public void Declared_mode_must_match_the_file()
    {
        string path = WriteCaseFile(Characters((BuildFixture, "career")));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.Contains("declared career but the file is in build mode", error.Message);
        Assert.StartsWith(path, error.Message);
    }

    [Fact]
    public void Unknown_property_fails_with_the_file_and_property()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["unexpected"] = true;
        string path = Write(document);

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.StartsWith(path, error.Message);
        Assert.Contains("unexpected", error.Message);
    }

    [Fact]
    public void Missing_required_property_fails_with_the_file_and_property()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document.Remove("careerActions");
        string path = Write(document);

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.StartsWith(path, error.Message);
        Assert.Contains("careerActions", error.Message);
    }

    [Fact]
    public void Unknown_action_type_fails()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["buildActions"] = new JsonArray(new JsonObject { ["type"] = "click" });

        Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
    }

    [Fact]
    public void Unknown_include_fails()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["buildActions"] = new JsonArray(Action("include", "name", "missing"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("unknown sequence 'missing'", error.Message);
    }

    [Fact]
    public void Include_cycle_fails()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["sequences"] = new JsonObject
        {
            ["a"] = new JsonArray(Action("include", "name", "b")),
            ["b"] = new JsonArray(Action("include", "name", "a")),
        };
        document["buildActions"] = new JsonArray(Action("include", "name", "a"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("includes itself (a -> b -> a)", error.Message);
    }

    [Fact]
    public void Action_fields_must_match_the_type()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["buildActions"] = new JsonArray(new JsonObject { ["type"] = "waitFor", ["name"] = "Skills" });

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("'waitFor' does not take 'name'", error.Message);
    }

    [Fact]
    public void Optional_is_only_allowed_on_select_tab()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["buildActions"] = new JsonArray(new JsonObject { ["type"] = "capture", ["name"] = "a", ["optional"] = true });

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("'capture' does not take 'optional'", error.Message);
    }

    [Fact]
    public void Duplicate_capture_names_fail()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["buildActions"] = new JsonArray(Action("capture", "name", "same"), Action("capture", "name", "same"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("capture name 'same' is used twice", error.Message);
    }

    [Fact]
    public void Missing_fixture_fails()
    {
        string path = Write(MinimalCaseFile(new JsonArray(new JsonObject { ["path"] = "nowhere.chum", ["mode"] = "build" })));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.Contains("fixture 'nowhere.chum' does not exist", error.Message);
    }

    [Fact]
    public void Same_fixture_twice_fails()
    {
        string path = WriteCaseFile(Characters((BuildFixture, "build"), (BuildFixture, "build")));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.Contains("case name 'build-Diego_v_alpha2_by_bessgeor'", error.Message);
    }

    [Fact]
    public void Unreadable_fixture_fails_as_a_case_file_error()
    {
        string fixture = Path.Combine(_directory, BuildFixture);
        File.Copy(Path.Combine(RepositoryPaths.Fixtures, BuildFixture), fixture);
        string path = Write(MinimalCaseFile(new JsonArray(new JsonObject { ["path"] = fixture, ["mode"] = "build" })));
        using FileStream locked = new(fixture, FileMode.Open, FileAccess.Read, FileShare.None);

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(path));
        Assert.Contains("not a readable character file", error.Message);
    }

    [Fact]
    public void Career_fixture_is_detected_as_career()
    {
        CharacterMode mode = new CharacterModeReader().Read(Path.Combine(RepositoryPaths.Fixtures, CareerFixture));

        Assert.Equal(CharacterMode.Career, mode);
    }

    private static JsonArray Characters(params (string File, string Mode)[] entries) =>
        new(entries.Select(entry => (JsonNode)new JsonObject
        {
            ["path"] = Path.Combine(RepositoryPaths.Fixtures, entry.File),
            ["mode"] = entry.Mode,
        }).ToArray());

    private static JsonObject Action(string type, string field, string value) => new() { ["type"] = type, [field] = value };

    private static JsonObject MinimalCaseFile(JsonArray characters) => new()
    {
        ["startupDelaySeconds"] = 0,
        ["settleMilliseconds"] = 0,
        ["sequences"] = new JsonObject(),
        ["buildActions"] = new JsonArray(Action("capture", "name", "common")),
        ["careerActions"] = new JsonArray(Action("capture", "name", "common")),
        ["characters"] = characters,
    };

    private string WriteCaseFile(JsonArray characters) => Write(MinimalCaseFile(characters));

    private string Write(JsonObject document)
    {
        string path = Path.Combine(_directory, $"{Guid.NewGuid():N}.json");
        File.WriteAllText(path, document.ToJsonString());
        return path;
    }
}
