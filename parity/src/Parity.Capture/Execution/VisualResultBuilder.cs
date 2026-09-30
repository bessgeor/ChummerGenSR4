using Parity.Cases;
using Parity.Contracts.CaptureResults;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Capture.Execution;

/// <summary>
/// Turns the captures of both sides of a case into visual result rows. A capture missing on one side
/// is a visual failure only when that side's capture action did not fail or stop: missing captures
/// caused by execution failures are reported as execution failures, not as visual rows.
/// </summary>
internal sealed class VisualResultBuilder(PixelComparer comparer)
{
    public IReadOnlyList<CaptureResult> Build(
        ParityCase parityCase,
        SideRun canonical,
        SideRun candidate,
        double threshold,
        Func<string, string> relativePath)
    {
        List<CaptureResult> results = [];
        foreach (CaptureAction capture in parityCase.Actions.OfType<CaptureAction>())
        {
            string name = capture.CaptureName;
            bool hasCanonical = canonical.Captures.TryGetValue(name, out string? canonicalPath);
            bool hasCandidate = candidate.Captures.TryGetValue(name, out string? candidatePath);
            if (!hasCanonical && !hasCandidate)
            {
                continue;
            }

            CaptureResult row = NewRow(parityCase, name);
            if (hasCanonical && hasCandidate)
            {
                ImageComparison comparison = comparer.Compare(canonicalPath!, candidatePath!);
                row.Difference = Math.Round(comparison.Difference, 6);
                row.Passed = comparison.Difference <= threshold;
                row.Reason = row.Passed ? ResultReason.WithinThreshold : ResultReason.VisualDifference;
                row.CanonicalCapture = relativePath(canonicalPath!);
                row.CandidateCapture = relativePath(candidatePath!);
                row.CanonicalSize = Size(comparison.LeftSize);
                row.CandidateSize = Size(comparison.RightSize);
                results.Add(row);
                continue;
            }

            SideRun missingSide = hasCanonical ? candidate : canonical;
            if (missingSide.CaptureOutcome(name) is OutcomeKind.Failed or OutcomeKind.NotRun)
            {
                continue;
            }

            string presentPath = hasCanonical ? canonicalPath! : candidatePath!;
            using (Bitmap present = new(presentPath))
            {
                if (hasCanonical)
                {
                    row.CanonicalCapture = relativePath(presentPath);
                    row.CanonicalSize = Size(present.Size);
                }
                else
                {
                    row.CandidateCapture = relativePath(presentPath);
                    row.CandidateSize = Size(present.Size);
                }
            }

            row.Difference = 1.0;
            row.Passed = false;
            row.Reason = hasCanonical ? ResultReason.MissingCandidate : ResultReason.MissingCanonical;
            results.Add(row);
        }

        return results;
    }

    private static CaptureResult NewRow(ParityCase parityCase, string captureName) => new()
    {
        Case = parityCase.Name,
        CharacterFile = parityCase.CharacterFile,
        Mode = parityCase.Mode == CharacterMode.Career ? Mode.Career : Mode.Build,
        Capture = captureName,
    };

    private static ImageSize Size(Size size) => new() { Width = size.Width, Height = size.Height };
}
