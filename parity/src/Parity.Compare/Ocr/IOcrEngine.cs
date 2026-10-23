using Parity.Contracts.CompareReport;
using Parity.Imaging;

namespace Parity.Compare.Ocr;

/// <summary>
/// Reads the text of a crop. Every result has an explicit state; a failed read is an error, never empty
/// text. An engine may also throw, and the comparer records the exception as the crop's error.
/// </summary>
internal interface IOcrEngine : IDisposable
{
    /// <summary>The OCR language, or null when OCR is disabled.</summary>
    string? Language { get; }

    OcrReading Read(ArgbImage crop);
}
