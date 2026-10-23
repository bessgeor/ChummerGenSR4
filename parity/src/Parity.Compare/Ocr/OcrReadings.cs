using Parity.Contracts.CompareReport;

namespace Parity.Compare.Ocr;

/// <summary>The four OCR result states.</summary>
internal static class OcrReadings
{
    public static OcrReading Disabled() => new() { Status = OcrStatus.Disabled };

    public static OcrReading Empty() => new() { Status = OcrStatus.Empty };

    public static OcrReading Text(string text) => new() { Status = OcrStatus.Text, Text = text };

    public static OcrReading Error(Exception error) => new() { Status = OcrStatus.Error, Error = $"{error.GetType().Name}: {error.Message}" };
}
