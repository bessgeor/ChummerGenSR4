namespace Parity.Compare.Ocr;

/// <summary>Creates the run's OCR engine once the options are known.</summary>
internal interface IOcrEngineFactory
{
    /// <summary>The engine; throws when OCR is enabled and the engine cannot start.</summary>
    IOcrEngine Create(bool enabled, string? tessdataDirectory);
}
