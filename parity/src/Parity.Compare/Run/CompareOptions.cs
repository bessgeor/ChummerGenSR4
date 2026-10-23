namespace Parity.Compare.Run;

/// <summary>Comparer options; see <see cref="CompareOptionsParser.Usage"/>.</summary>
internal sealed record CompareOptions
{
    public bool Help { get; init; }

    public string? Run { get; init; }

    public bool Ocr { get; init; } = true;

    public string? Tessdata { get; init; }
}
