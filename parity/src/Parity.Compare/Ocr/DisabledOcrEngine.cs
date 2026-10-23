using Parity.Contracts.CompareReport;
using Parity.Imaging;

namespace Parity.Compare.Ocr;

/// <summary>The engine used with <c>--no-ocr</c>: every result is <c>disabled</c>.</summary>
internal sealed class DisabledOcrEngine : IOcrEngine
{
    public string? Language => null;

    public OcrReading Read(ArgbImage crop) => OcrReadings.Disabled();

    public void Dispose()
    {
    }
}
