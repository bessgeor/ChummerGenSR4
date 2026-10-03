using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Xml.Linq;
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
    public void Repository_case_file_loads_every_fixture_with_its_declared_mode()
    {
        CaseSuite suite = _loader.Load(RepositoryPaths.CaseFile);

        Assert.Equal(3, suite.StartupDelaySeconds);
        Assert.Equal(300, suite.SettleMilliseconds);
        Assert.Equal(
            [
                "build-Diego_v_alpha2_by_bessgeor",
                "career-Шпала - карьера",
                "build-facemage_Sam",
                "career-facemage_Sam_career",
                "build-rigger",
                "career-rigger_career",
                "build-hacker4boegspriet",
                "build-technotest",
                "career-technotest - career",
                "career-test_adept",
                "build-spirit",
                "build-Skull Carver - precareer",
                "career-Skull Carver - career",
            ],
            suite.Cases.Select(item => item.Name));
        Assert.Equal(13, Directory.GetFiles(Path.Combine(RepositoryPaths.Root, "parity", "fixtures", "characters"), "*.chum").Length);
        Assert.Collection(
            suite.Cases.Take(2),
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
    public void Fixtures_link_no_other_character_file()
    {
        foreach (string fixture in Directory.GetFiles(Path.Combine(RepositoryPaths.Root, "parity", "fixtures", "characters"), "*.chum"))
        {
            XDocument document = XDocument.Load(fixture);
            Assert.All(
                document.Descendants().Where(element => element.Name.LocalName is "file" or "relative"),
                element => Assert.True(element.Value.Length == 0, $"{Path.GetFileName(fixture)} links {element.Value}"));
        }
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
    public void Entry_with_a_scenario_runs_its_own_actions_under_its_own_name()
    {
        JsonArray characters = Characters((BuildFixture, "build"), (BuildFixture, "build"));
        characters[1]!["scenario"] = "improvements";
        characters[1]!["actions"] = new JsonArray(Action("selectTab", "name", "Improvements"), Action("capture", "name", "improvements"));
        CaseSuite suite = _loader.Load(WriteCaseFile(characters));

        Assert.Equal(["build-Diego_v_alpha2_by_bessgeor", "build-Diego_v_alpha2_by_bessgeor@improvements"], suite.Cases.Select(item => item.Name));
        Assert.Equal([new CaptureAction("common")], suite.Cases[0].Actions);
        Assert.Equal([new SelectTabAction("Improvements", Optional: false), new CaptureAction("improvements")], suite.Cases[1].Actions);
        Assert.Equal(BuildFixture, suite.Cases[1].CharacterFile);
    }

    [Fact]
    public void Entry_actions_expand_sequences_and_name_their_location()
    {
        JsonObject document = MinimalCaseFile(Characters((BuildFixture, "build")));
        document["sequences"] = new JsonObject { ["skills"] = new JsonArray(Action("selectTab", "name", "Skills")) };
        JsonNode entry = ((JsonArray)document["characters"]!)[0]!;
        entry["scenario"] = "skills";
        entry["actions"] = new JsonArray(Action("include", "name", "skills"), Action("waitFor", "name", "x"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(Write(document)));
        Assert.Contains("characters[0].actions[1]: 'waitFor' does not take 'name'", error.Message);
    }

    [Theory]
    [InlineData(true, false)]
    [InlineData(false, true)]
    public void Scenario_and_actions_come_together(bool scenario, bool actions)
    {
        JsonArray characters = Characters((BuildFixture, "build"));
        if (scenario) characters[0]!["scenario"] = "alone";
        if (actions) characters[0]!["actions"] = new JsonArray(Action("capture", "name", "common"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(WriteCaseFile(characters)));
        Assert.Contains("characters[0]: 'scenario' and 'actions' are given together or not at all", error.Message);
    }

    [Fact]
    public void Scenario_name_must_be_lower_case_letters_digits_and_dashes()
    {
        JsonArray characters = Characters((BuildFixture, "build"));
        characters[0]!["scenario"] = "Upper Case";
        characters[0]!["actions"] = new JsonArray(Action("capture", "name", "common"));

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(WriteCaseFile(characters)));
        Assert.Contains("scenario 'Upper Case'", error.Message);
    }

    [Fact]
    public void Scenario_with_no_action_fails()
    {
        JsonArray characters = Characters((BuildFixture, "build"));
        characters[0]!["scenario"] = "empty";
        characters[0]!["actions"] = new JsonArray();

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(WriteCaseFile(characters)));
        Assert.Contains("characters[0]: 'actions' holds no action", error.Message);
    }

    [Theory]
    [InlineData("pets", true)]
    [InlineData("0-day", true)]
    [InlineData("a", true)]
    [InlineData("-pets", false)]
    [InlineData("Pets", false)]
    [InlineData("pets_2", false)]
    [InlineData("pets\n", false)]
    [InlineData("", false)]
    public void Scenario_names_are_accepted_as_the_schema_pattern_says(string scenario, bool accepted)
    {
        string pattern = JsonNode.Parse(File.ReadAllText(Path.Combine(RepositoryPaths.Contracts, "schemas", "parity-cases.schema.json")))!
            ["definitions"]!["CharacterEntry"]!["properties"]!["scenario"]!["pattern"]!.GetValue<string>();
        Assert.Equal(accepted, new Regex(pattern.Replace("$", "\\z", StringComparison.Ordinal), RegexOptions.CultureInvariant).IsMatch(scenario));

        JsonArray characters = Characters((BuildFixture, "build"));
        characters[0]!["scenario"] = scenario;
        characters[0]!["actions"] = new JsonArray(Action("capture", "name", "common"));
        if (accepted)
        {
            Assert.Equal($"build-Diego_v_alpha2_by_bessgeor@{scenario}", _loader.Load(WriteCaseFile(characters)).Cases.Single().Name);
        }
        else
        {
            Assert.Throws<CaseFileException>(() => _loader.Load(WriteCaseFile(characters)));
        }
    }

    [Fact]
    public void Two_entries_with_one_scenario_name_fail()
    {
        JsonArray characters = Characters((BuildFixture, "build"), (BuildFixture, "build"));
        foreach (JsonNode? entry in characters)
        {
            entry!["scenario"] = "same";
            entry["actions"] = new JsonArray(Action("capture", "name", "common"));
        }

        CaseFileException error = Assert.Throws<CaseFileException>(() => _loader.Load(WriteCaseFile(characters)));
        Assert.Contains("case name 'build-Diego_v_alpha2_by_bessgeor@same'", error.Message);
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
