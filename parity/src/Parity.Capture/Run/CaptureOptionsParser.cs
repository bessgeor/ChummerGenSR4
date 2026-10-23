using System.Globalization;
using static Parity.Cases.OptionArguments;

namespace Parity.Capture.Run;

/// <summary>Parses <c>--name value</c> options; unknown options and missing values are errors.</summary>
internal sealed class CaptureOptionsParser
{
    public const string Usage = """
        Usage: npm run parity -- [options]

          --case <names>             case names or character file names, comma-separated (default: all)
          --capture <names>          capture names to write, comma-separated (default: all; every action still runs)
          --settings-overlay <dir>   folder copied over both staged apps, e.g. <dir>/settings/default.xml;
                                     must be outside the repository or under out/
          --threshold <ratio>        largest passing share of differing pixels (default: 0.00004)
          --case-file <path>         default: parity/cases/characters.json
          --canonical-exe <path>     default: bin/ChummerGenSR4.exe (verified by SHA-256, never modified)
          --candidate-exe <path>     default: out/candidate/bin/ChummerGenSR4.exe
          --runs-dir <path>          default: out/runs
          --run-folder-file <path>   file that receives the run folder's full path once the folder exists
          --repo-root <path>         default: the current directory
          --help

        Exit status: 0 all passed, 1 visual differences, 2 execution failures, 3 setup error.
        """;

    public CaptureOptions Parse(IReadOnlyList<string> args)
    {
        CaptureOptions options = new();
        List<string> cases = [];
        List<string> captures = [];
        for (int index = 0; index < args.Count; index++)
        {
            string option = args[index];
            switch (option)
            {
                case "--help" or "-h":
                    options = options with { Help = true };
                    break;
                case "--case":
                    cases.AddRange(List(Value(args, ref index)));
                    break;
                case "--capture":
                    captures.AddRange(List(Value(args, ref index)));
                    break;
                case "--settings-overlay":
                    options = options with { SettingsOverlay = Value(args, ref index) };
                    break;
                case "--threshold":
                    options = options with { Threshold = Threshold(Value(args, ref index)) };
                    break;
                case "--case-file":
                    options = options with { CaseFile = Value(args, ref index) };
                    break;
                case "--canonical-exe":
                    options = options with { CanonicalExecutable = Value(args, ref index) };
                    break;
                case "--candidate-exe":
                    options = options with { CandidateExecutable = Value(args, ref index) };
                    break;
                case "--run-folder-file":
                    options = options with { RunFolderFile = Value(args, ref index) };
                    break;
                case "--runs-dir":
                    options = options with { RunsDirectory = Value(args, ref index) };
                    break;
                case "--repo-root":
                    options = options with { RepositoryRoot = Path.GetFullPath(Value(args, ref index)) };
                    break;
                default:
                    throw new ArgumentException($"Unknown option '{option}'.");
            }
        }

        return options with { Cases = cases, Captures = captures };
    }

    private static IEnumerable<string> List(string value) =>
        value.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

    private static double Threshold(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out double threshold) && threshold is >= 0 and <= 1
            ? threshold
            : throw new ArgumentException($"--threshold must be a number from 0 to 1, got '{value}'.");
}
