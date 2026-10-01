using System.Text.Json;
using System.Text.Json.Serialization;
using CaptureResultsContract = Parity.Contracts.CaptureResults.CaptureResults;
using CaptureSummaryContract = Parity.Contracts.CaptureSummary.CaptureSummary;
using CompareReportContract = Parity.Contracts.CompareReport.CompareReport;
using ParityCasesContract = Parity.Contracts.ParityCases.ParityCases;

namespace Parity.Cases;

/// <summary>
/// Reads and writes contract documents with the generated converters. Reading is strict:
/// unknown properties, missing required properties and nulls for non-nullable properties fail.
/// </summary>
public static class ContractJson
{
    private static readonly JsonSerializerOptions CasesOptions = Strict(Parity.Contracts.ParityCases.Converter.Settings);
    private static readonly JsonSerializerOptions SummaryOptions = Strict(Parity.Contracts.CaptureSummary.Converter.Settings);
    private static readonly JsonSerializerOptions ResultsOptions = Strict(Parity.Contracts.CaptureResults.Converter.Settings);
    private static readonly JsonSerializerOptions ReportOptions = Strict(Parity.Contracts.CompareReport.Converter.Settings);

    public static ParityCasesContract ReadCases(string json) => Read<ParityCasesContract>(json, CasesOptions);

    public static CaptureSummaryContract ReadSummary(string json) => Read<CaptureSummaryContract>(json, SummaryOptions);

    public static CaptureResultsContract ReadResults(string json) => Read<CaptureResultsContract>(json, ResultsOptions);

    public static CompareReportContract ReadReport(string json) => Read<CompareReportContract>(json, ReportOptions);

    public static string Write(ParityCasesContract document) => JsonSerializer.Serialize(document, CasesOptions);

    public static string Write(CaptureSummaryContract document) => JsonSerializer.Serialize(document, SummaryOptions);

    public static string Write(CaptureResultsContract document) => JsonSerializer.Serialize(document, ResultsOptions);

    public static string Write(CompareReportContract document) => JsonSerializer.Serialize(document, ReportOptions);

    /// <summary>A report status spelled as the contract writes it in <c>report.json</c>.</summary>
    public static string Name(Parity.Contracts.CompareReport.ReportStatus status) =>
        JsonSerializer.SerializeToElement(status, ReportOptions).GetString()!;

    private static T Read<T>(string json, JsonSerializerOptions options)
        where T : class =>
        JsonSerializer.Deserialize<T>(json, options)
        ?? throw new JsonException($"The document is null, expected a {typeof(T).Name} object.");

    private static JsonSerializerOptions Strict(JsonSerializerOptions generated) =>
        new(generated)
        {
            UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow,
            RespectNullableAnnotations = true,
            WriteIndented = true,
        };
}
