using System.Text.Json;
using System.Text.RegularExpressions;
using ParityCasesContract = Parity.Contracts.ParityCases.ParityCases;
using WireCharacterEntry = Parity.Contracts.ParityCases.CharacterEntry;
using WireCharacterMode = Parity.Contracts.ParityCases.CharacterMode;

namespace Parity.Cases;

/// <summary>Loads a case file and validates it against the fixtures it names.</summary>
public sealed class CaseFileLoader(ActionExpander expander, CharacterModeReader modeReader)
{
    private static readonly Regex ScenarioName = new(@"^[a-z0-9][a-z0-9-]*\z", RegexOptions.CultureInvariant);

    public CaseSuite Load(string caseFilePath)
    {
        string fullPath = Path.GetFullPath(caseFilePath);
        if (!File.Exists(fullPath))
        {
            throw new CaseFileException(fullPath, "the case file does not exist.");
        }

        string json;
        try
        {
            json = File.ReadAllText(fullPath);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            throw new CaseFileException(fullPath, $"the case file cannot be read: {error.Message}", error);
        }

        ParityCasesContract document;
        try
        {
            document = ContractJson.ReadCases(json);
        }
        catch (Exception error) when (error is JsonException || error.GetType() == typeof(Exception))
        {
            // The generated converters throw a plain Exception for enum and length violations.
            throw new CaseFileException(fullPath, $"invalid case file: {error.Message}", error);
        }

        try
        {
            return Build(fullPath, document);
        }
        catch (InvalidDataException error)
        {
            throw new CaseFileException(fullPath, error.Message, error);
        }
    }

    private CaseSuite Build(string caseFilePath, ParityCasesContract document)
    {
        string caseDirectory = Path.GetDirectoryName(caseFilePath)!;
        List<ParityCase> cases = [];
        for (int index = 0; index < document.Characters.Count; index++)
        {
            cases.Add(BuildCase(caseDirectory, document, document.Characters[index], $"characters[{index}]"));
        }

        string? duplicate = cases.GroupBy(item => item.Name, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1)?.Key;
        if (duplicate is not null)
        {
            throw new InvalidDataException($"two characters produce the case name '{duplicate}'.");
        }

        return new CaseSuite(
            caseFilePath,
            ToInt(document.StartupDelaySeconds, "startupDelaySeconds"),
            ToInt(document.SettleMilliseconds, "settleMilliseconds"),
            cases);
    }

    private ParityCase BuildCase(
        string caseDirectory,
        ParityCasesContract document,
        WireCharacterEntry entry,
        string location)
    {
        string characterPath = Path.GetFullPath(Path.Combine(caseDirectory, entry.Path));
        if (!File.Exists(characterPath))
        {
            throw new InvalidDataException($"{location}: fixture '{entry.Path}' does not exist.");
        }

        CharacterMode declared = entry.Mode == WireCharacterMode.Career ? CharacterMode.Career : CharacterMode.Build;
        CharacterMode actual = modeReader.Read(characterPath);
        if (declared != actual)
        {
            throw new InvalidDataException(
                $"{location}: '{entry.Path}' is declared {Wire(declared)} but the file is in {Wire(actual)} mode.");
        }

        if ((entry.Scenario is null) != (entry.Actions is null))
        {
            throw new InvalidDataException($"{location}: 'scenario' and 'actions' are given together or not at all.");
        }

        if (entry.Actions is { Count: 0 })
        {
            throw new InvalidDataException($"{location}: 'actions' holds no action.");
        }

        if (entry.Scenario is not null && !ScenarioName.IsMatch(entry.Scenario))
        {
            throw new InvalidDataException(
                $"{location}: scenario '{entry.Scenario}' is not lower-case letters, digits and dashes starting with a letter or digit.");
        }

        IReadOnlyList<ParityAction> actions = entry.Actions is not null
            ? expander.Expand(entry.Actions, document.Sequences, $"{location}.actions")
            : declared == CharacterMode.Career
                ? expander.Expand(document.CareerActions, document.Sequences, "careerActions")
                : expander.Expand(document.BuildActions, document.Sequences, "buildActions");
        string? duplicateCapture = actions.OfType<CaptureAction>()
            .GroupBy(action => action.CaptureName, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1)?.Key;
        if (duplicateCapture is not null)
        {
            throw new InvalidDataException($"{location}: capture name '{duplicateCapture}' is used twice.");
        }

        string name = $"{Wire(declared)}-{Path.GetFileNameWithoutExtension(characterPath)}";
        if (entry.Scenario is not null)
        {
            name = $"{name}@{entry.Scenario}";
        }

        return new ParityCase(name, Path.GetFileName(characterPath), characterPath, declared, actions);
    }

    private static int ToInt(long value, string property) =>
        value is >= 0 and <= int.MaxValue
            ? (int)value
            : throw new InvalidDataException($"'{property}' is {value}, outside 0..{int.MaxValue}.");

    private static string Wire(CharacterMode mode) => mode == CharacterMode.Career ? "career" : "build";
}
