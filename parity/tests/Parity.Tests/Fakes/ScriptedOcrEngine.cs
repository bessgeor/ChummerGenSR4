using Parity.Compare.Ocr;
using Parity.Contracts.CompareReport;
using Parity.Imaging;

namespace Parity.Tests.Fakes;

/// <summary>An OCR engine whose results come from a function; it records the size of every crop it reads.</summary>
internal sealed class ScriptedOcrEngine(Func<ArgbImage, OcrReading> read) : IOcrEngine, IOcrEngineFactory
{
    public List<Size> Reads { get; } = [];

    public string? Language => "test";

    public OcrReading Read(ArgbImage crop)
    {
        Reads.Add(crop.Size);
        return read(crop);
    }

    public IOcrEngine Create(bool enabled, string? tessdataDirectory) => enabled ? this : new DisabledOcrEngine();

    public void Dispose()
    {
    }
}
