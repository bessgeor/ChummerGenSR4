using System.Text.Json;
using System.Text.Json.Nodes;
using Parity.Cases;

namespace Parity.Tests;

/// <summary>Every schema's example survives deserialize and serialize with the generated C# types.</summary>
public sealed class ContractRoundTripTests
{
    /// <summary>C# round-trip per schema title; a schema without an entry fails the test.</summary>
    private static readonly Dictionary<string, Func<string, string>> RoundTrips = new(StringComparer.Ordinal)
    {
        ["ParityCases"] = json => ContractJson.Write(ContractJson.ReadCases(json)),
        ["CaptureSummary"] = json => ContractJson.Write(ContractJson.ReadSummary(json)),
        ["CaptureResults"] = json => ContractJson.Write(ContractJson.ReadResults(json)),
        ["CompareReport"] = json => ContractJson.Write(ContractJson.ReadReport(json)),
        ["ExecutionCoverage"] = json => ContractJson.Write(ContractJson.ReadCoverage(json)),
        ["CaptureTiming"] = json => ContractJson.Write(ContractJson.ReadTiming(json)),
    };

    public static TheoryData<string> Schemas()
    {
        TheoryData<string> data = [];
        foreach (string file in Directory.GetFiles(Path.Combine(RepositoryPaths.Contracts, "schemas"), "*.schema.json").Order(StringComparer.Ordinal))
        {
            data.Add(Path.GetFileName(file));
        }

        return data;
    }

    [Theory]
    [MemberData(nameof(Schemas))]
    public void Example_round_trips_through_generated_types(string schemaFile)
    {
        string baseName = schemaFile[..^".schema.json".Length];
        string title = JsonNode.Parse(File.ReadAllText(Path.Combine(RepositoryPaths.Contracts, "schemas", schemaFile)))!["title"]!.GetValue<string>();
        string examplePath = Path.Combine(RepositoryPaths.Contracts, "examples", $"{baseName}.example.json");
        Assert.True(File.Exists(examplePath), $"{schemaFile} has no example at contracts/examples/{baseName}.example.json");
        Assert.True(RoundTrips.TryGetValue(title, out Func<string, string>? roundTrip), $"{schemaFile} ({title}) has no C# round-trip test.");

        string example = File.ReadAllText(examplePath);
        string written = roundTrip(example);

        JsonNode? expected = JsonNode.Parse(example);
        JsonNode? actual = JsonNode.Parse(written);
        Assert.True(JsonNode.DeepEquals(expected, actual), $"{baseName} changed in the round-trip:\n{written}");
    }

    [Fact]
    public void Report_status_names_are_the_schema_values()
    {
        JsonNode schema = JsonNode.Parse(File.ReadAllText(Path.Combine(RepositoryPaths.Contracts, "schemas", "parity-compare-report.schema.json")))!;
        string[] values = schema["definitions"]!["ReportStatus"]!["enum"]!.AsArray().Select(value => value!.GetValue<string>()).ToArray();

        string[] names = Enum.GetValues<Parity.Contracts.CompareReport.ReportStatus>().Select(ContractJson.Name).ToArray();

        Assert.Equal(values.Order(StringComparer.Ordinal), names.Order(StringComparer.Ordinal));
    }

    [Fact]
    public void Summary_reader_rejects_unknown_property()
    {
        string example = File.ReadAllText(Path.Combine(RepositoryPaths.Contracts, "examples", "parity-capture-summary.example.json"));
        JsonObject document = JsonNode.Parse(example)!.AsObject();
        document["unexpected"] = 1;

        Assert.Throws<JsonException>(() => ContractJson.ReadSummary(document.ToJsonString()));
    }

    [Fact]
    public void Results_reader_rejects_null_for_required_property()
    {
        string example = File.ReadAllText(Path.Combine(RepositoryPaths.Contracts, "examples", "parity-capture-results.example.json"));
        JsonObject document = JsonNode.Parse(example)!.AsObject();
        document["runId"] = null;

        Assert.ThrowsAny<Exception>(() => ContractJson.ReadResults(document.ToJsonString()));
    }
}
