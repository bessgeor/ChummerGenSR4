using System.Globalization;
using System.Runtime.InteropServices;
using Parity.Compare.Detection;
using Parity.Compare.Ocr;
using Parity.Compare.Run;
using Parity.Contracts.CaptureResults;
using Parity.Contracts.CompareReport;
using Parity.Imaging;

namespace Parity.Compare.Analysis;

/// <summary>
/// Analyzes one row of <c>results.json</c>. Passed rows are not analyzed; missing captures and size
/// mismatches keep their own status; a failing row of equal sizes is located from the raw pixel
/// difference, which must agree with the difference the capture run recorded.
/// </summary>
internal sealed class RowAnalyzer(DiscrepancyLocator locator, ImageHasher hasher)
{
    /// <summary>How far a crop is widened when neither side's OCR read any text.</summary>
    private static readonly Size EmptyTextWidening = new(48, 24);

    public RowAnalysis Analyze(CaptureResult row, RunFolder folder, IOcrEngine ocr) => row.Reason switch
    {
        ResultReason.WithinThreshold => RowAnalysis.Without(row, RowStatus.Passed),
        ResultReason.MissingCanonical => Missing(row, row.CandidateCapture, folder, RowStatus.MissingCanonical),
        ResultReason.MissingCandidate => Missing(row, row.CanonicalCapture, folder, RowStatus.MissingCandidate),
        ResultReason.VisualDifference => Guarded(row, () => VisualDifference(row, folder, ocr)),
        _ => throw new ArgumentOutOfRangeException(nameof(row), row.Reason, "Unknown result reason."),
    };

    /// <summary>Any error while analyzing a row, for example a crop that cannot be written, fails that row.</summary>
    private static RowAnalysis Guarded(CaptureResult row, Func<RowAnalysis> analyze)
    {
        try
        {
            return analyze();
        }
        catch (Exception error)
        {
            return RowAnalysis.Failed(row, $"The row could not be analyzed: {error.GetType().Name}: {error.Message}");
        }
    }

    private static RowAnalysis Missing(CaptureResult row, string? present, RunFolder folder, RowStatus status)
    {
        if (present is null)
        {
            return RowAnalysis.Failed(row, "The row names no capture for the side that produced one.");
        }

        return File.Exists(folder.Resolve(present))
            ? RowAnalysis.Without(row, status)
            : RowAnalysis.Failed(row, $"The capture file {present} does not exist.");
    }

    private RowAnalysis VisualDifference(CaptureResult row, RunFolder folder, IOcrEngine ocr)
    {
        if (row.CanonicalCapture is null || row.CandidateCapture is null)
        {
            return RowAnalysis.Failed(row, "The row lacks a canonical or a candidate capture path.");
        }

        ArgbImage canonical;
        ArgbImage candidate;
        try
        {
            canonical = Load(folder.Resolve(row.CanonicalCapture));
            candidate = Load(folder.Resolve(row.CandidateCapture));
        }
        catch (Exception error) when (error is IOException or ArgumentException or UnauthorizedAccessException or OutOfMemoryException or ExternalException)
        {
            return RowAnalysis.Failed(row, $"A capture cannot be read: {error.GetType().Name}: {error.Message}");
        }

        if (!Matches(row.CanonicalSize, canonical.Size) || !Matches(row.CandidateSize, candidate.Size))
        {
            return RowAnalysis.Failed(row, $"The captures are {Format(canonical.Size)} and {Format(candidate.Size)}, which differs from the sizes the row records.");
        }

        if (canonical.Size != candidate.Size)
        {
            return RowAnalysis.Without(row, RowStatus.SizeMismatch);
        }

        PixelDifference difference = PixelDifference.Of(canonical, candidate);
        double recomputed = Math.Round(difference.Ratio, 6);
        if (difference.Count == 0 || recomputed != row.Difference)
        {
            return RowAnalysis.Failed(row, string.Create(
                CultureInfo.InvariantCulture,
                $"The captures differ in {difference.Count} pixels, a difference of {recomputed}, but the row records {row.Difference}."));
        }

        List<DescribedChange> described = [];
        foreach (LocatedChange change in locator.Locate(canonical, candidate, difference))
        {
            described.Add(Describe(row, folder, ocr, canonical, candidate, change, described.Count + 1));
        }

        List<Finding> findings = described.Select(item => item.Finding).ToList();
        long located = findings.Sum(finding => finding.DifferingPixels);
        if (located != difference.Count)
        {
            return RowAnalysis.Failed(row, $"The discrepancies hold {located} differing pixels, but the captures differ in {difference.Count}.");
        }

        SaveCrops(described);
        return RowAnalysis.Analyzed(row, difference.Count, findings);
    }

    /// <summary>
    /// Writes the row's crop files once the whole row is described. When one cannot be written, the
    /// crops already written are removed, so a failed row leaves no crop behind.
    /// </summary>
    private static void SaveCrops(IReadOnlyList<DescribedChange> described)
    {
        List<string> written = [];
        try
        {
            foreach (DescribedChange item in described)
            {
                foreach ((string path, ArgbImage image) in new[] { (item.CanonicalPath, item.CanonicalCrop), (item.CandidatePath, item.CandidateCrop) })
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                    written.Add(path);
                    image.SavePng(path);
                }
            }
        }
        catch (Exception error)
        {
            try
            {
                foreach (string path in written.Where(File.Exists))
                {
                    File.Delete(path);
                }
            }
            catch (Exception cleanup) when (cleanup is IOException or UnauthorizedAccessException)
            {
                throw new IOException($"{error.Message} The crops already written could not be removed: {cleanup.Message}", error);
            }

            throw;
        }
    }

    /// <summary>A discrepancy and the crop images that are written for it once its row is complete.</summary>
    private sealed record DescribedChange(Finding Finding, string CanonicalPath, ArgbImage CanonicalCrop, string CandidatePath, ArgbImage CandidateCrop);

    private DescribedChange Describe(CaptureResult row, RunFolder folder, IOcrEngine ocr, ArgbImage canonical, ArgbImage candidate, LocatedChange change, int number)
    {
        Rectangle crop = change.Crop;
        OcrReading canonicalText = Read(ocr, canonical.Crop(crop));
        OcrReading candidateText = Read(ocr, candidate.Crop(crop));
        if (canonicalText.Status == OcrStatus.Empty && candidateText.Status == OcrStatus.Empty)
        {
            crop = Detection.Regions.Inflate(crop, EmptyTextWidening.Width, EmptyTextWidening.Height, canonical.Size);
            canonicalText = Read(ocr, canonical.Crop(crop));
            candidateText = Read(ocr, candidate.Crop(crop));
        }

        string canonicalCrop = folder.CropPath(row.Case, row.Capture, number, "canonical");
        string candidateCrop = folder.CropPath(row.Case, row.Capture, number, "candidate");
        Finding finding = new(
            $"{row.Case}/{row.Capture}#{number}",
            row.Case,
            row.Capture,
            canonical.Size,
            change.Core,
            crop,
            change.DifferingPixels,
            hasher.Hash(canonical, candidate, change.Core),
            folder.Relative(canonicalCrop),
            folder.Relative(candidateCrop),
            canonicalText,
            candidateText);
        return new DescribedChange(finding, canonicalCrop, canonical.Crop(crop), candidateCrop, candidate.Crop(crop));
    }

    /// <summary>Whatever the engine throws while reading a crop is that crop's OCR error, never empty text.</summary>
    private static OcrReading Read(IOcrEngine ocr, ArgbImage crop)
    {
        try
        {
            return ocr.Read(crop);
        }
        catch (Exception error)
        {
            return OcrReadings.Error(error);
        }
    }

    private static ArgbImage Load(string path) =>
        File.Exists(path) ? ArgbImage.Load(path) : throw new FileNotFoundException($"The capture file {path} does not exist.", path);

    private static bool Matches(Parity.Contracts.CaptureResults.ImageSize? recorded, Size actual) =>
        recorded is null || (recorded.Width == actual.Width && recorded.Height == actual.Height);

    private static string Format(Size size) => $"{size.Width}×{size.Height}";
}
