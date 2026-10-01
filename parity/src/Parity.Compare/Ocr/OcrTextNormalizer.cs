namespace Parity.Compare.Ocr;

/// <summary>
/// Cleans OCR text for reading: trims each line and drops blank ones. Nothing else is changed, so the
/// recorded text, misreadings included, never shows a word or a unit that OCR did not read.
/// </summary>
internal static class OcrTextNormalizer
{
    public static string Normalize(string raw) =>
        string.Join("\n", raw.Replace("\r\n", "\n").Split('\n').Select(line => line.Trim()).Where(line => line.Length > 0));
}
