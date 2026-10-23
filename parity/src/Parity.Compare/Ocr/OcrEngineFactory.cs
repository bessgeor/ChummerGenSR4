namespace Parity.Compare.Ocr;

/// <summary>Tesseract with the language data copied beside the comparer, unless another folder is given.</summary>
internal sealed class OcrEngineFactory(OcrImagePreparer preparer) : IOcrEngineFactory
{
    public IOcrEngine Create(bool enabled, string? tessdataDirectory) =>
        enabled
            ? new TesseractOcrEngine(tessdataDirectory ?? Path.Combine(AppContext.BaseDirectory, "tessdata"), preparer)
            : new DisabledOcrEngine();
}
