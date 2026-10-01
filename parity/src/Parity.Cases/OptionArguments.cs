namespace Parity.Cases;

/// <summary>Command-line helpers shared by the parity tools' <c>--name value</c> option parsers.</summary>
public static class OptionArguments
{
    /// <summary>The value after the option at <paramref name="index"/>, which moves past it; a missing value is an error.</summary>
    public static string Value(IReadOnlyList<string> args, ref int index)
    {
        string option = args[index];
        if (++index >= args.Count || args[index].StartsWith("--", StringComparison.Ordinal))
        {
            throw new ArgumentException($"Option '{option}' needs a value.");
        }

        return args[index];
    }
}
