using static Parity.Cases.OptionArguments;

namespace Parity.Compare.Run;

/// <summary>Parses <c>--name value</c> options; unknown options, missing values and a missing <c>--run</c> are errors.</summary>
internal sealed class CompareOptionsParser
{
    public const string Usage = """
        Usage: npm run compare -- --run <run folder> [options]

          --run <dir>        capture run folder, e.g. out/runs/<runId>; reads results.json and
                             replaces <dir>/compare/ with report.json and the crops
          --no-ocr           do not read text from the crops (every OCR result is "disabled")
          --tessdata <dir>   folder holding eng.traineddata (default: tessdata beside the comparer)
          --help

        Exit status: 0 every row passed, 1 differences reported, 2 analysis failures, 3 setup error.
        """;

    public CompareOptions Parse(IReadOnlyList<string> args)
    {
        CompareOptions options = new();
        for (int index = 0; index < args.Count; index++)
        {
            string option = args[index];
            options = option switch
            {
                "--help" or "-h" => options with { Help = true },
                "--run" => options with { Run = Value(args, ref index) },
                "--no-ocr" => options with { Ocr = false },
                "--tessdata" => options with { Tessdata = Value(args, ref index) },
                _ => throw new ArgumentException($"Unknown option '{option}'."),
            };
        }

        return options.Help || options.Run is not null
            ? options
            : throw new ArgumentException("--run <run folder> is required.");
    }
}
