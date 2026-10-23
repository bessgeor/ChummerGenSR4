namespace Parity.Capture.Execution;

/// <summary>The pixel difference ratio of two images and their sizes.</summary>
internal sealed record ImageComparison(double Difference, Size LeftSize, Size RightSize);
