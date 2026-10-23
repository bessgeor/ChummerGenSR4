using System.Security.Cryptography;
using Parity.Contracts.CompareReport;
using Parity.Imaging;
using Tesseract;

namespace Parity.Compare.Ocr;

/// <summary>
/// Tesseract OCR with one engine per run (English, page segmentation mode 6, 300 dpi). Results are
/// cached by the hash of the prepared image; a failed read throws and is not cached.
/// </summary>
internal sealed class TesseractOcrEngine : IOcrEngine
{
    public const string EnglishLanguage = "eng";

    private readonly TesseractEngine _engine;
    private readonly OcrImagePreparer _preparer;
    private readonly Dictionary<string, OcrReading> _cache = new(StringComparer.Ordinal);

    /// <summary>Creates the engine; a missing language data file or an engine that cannot start throws.</summary>
    public TesseractOcrEngine(string tessdataDirectory, OcrImagePreparer preparer)
    {
        string trainedData = Path.Combine(tessdataDirectory, $"{EnglishLanguage}.traineddata");
        if (!File.Exists(trainedData))
        {
            throw new FileNotFoundException($"OCR language data not found: {trainedData}. Pass --tessdata <dir> or --no-ocr.", trainedData);
        }

        _engine = new TesseractEngine(tessdataDirectory, EnglishLanguage, EngineMode.Default);
        _engine.SetVariable("user_defined_dpi", "300");
        _preparer = preparer;
    }

    public string? Language => EnglishLanguage;

    /// <summary>Reads a crop's text; a failure throws, and the caller records it as an <c>error</c> result.</summary>
    public OcrReading Read(ArgbImage crop)
    {
        byte[] prepared = _preparer.Prepare(crop);
        string key = Convert.ToHexStringLower(SHA256.HashData(prepared));
        if (_cache.TryGetValue(key, out OcrReading? cached))
        {
            return cached;
        }

        using Pix pix = Pix.LoadFromMemory(prepared);
        using Page page = _engine.Process(pix, PageSegMode.SingleBlock);
        string text = OcrTextNormalizer.Normalize(page.GetText() ?? string.Empty);
        OcrReading reading = text.Length == 0 ? OcrReadings.Empty() : OcrReadings.Text(text);
        _cache[key] = reading;
        return reading;
    }

    public void Dispose() => _engine.Dispose();
}
