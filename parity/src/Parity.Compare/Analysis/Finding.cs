using Parity.Contracts.CompareReport;

namespace Parity.Compare.Analysis;

/// <summary>One discrepancy of a capture pair, with its crops (paths relative to the run folder) and OCR results.</summary>
internal sealed record Finding(
    string Id,
    string Case,
    string Capture,
    Size CaptureSize,
    Rectangle Core,
    Rectangle Crop,
    long DifferingPixels,
    string ImageHash,
    string CanonicalCrop,
    string CandidateCrop,
    OcrReading CanonicalOcr,
    OcrReading CandidateOcr);
