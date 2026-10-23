using Parity.Compare.Analysis;

namespace Parity.Compare.Grouping;

/// <summary>
/// Groups duplicate discrepancies by change area plus image hash: a discrepancy joins the first earlier
/// representative with the same core image hash whose core sits at nearly the same place (position match
/// of at least 97 %). OCR text plays no part. Every discrepancy belongs to exactly one group.
/// </summary>
internal sealed class DuplicateGrouper
{
    public const double MinimumPositionMatch = 97.0;

    /// <summary>The groups in report order; each lists its representative first.</summary>
    public IReadOnlyList<IReadOnlyList<Finding>> Group(IReadOnlyList<Finding> findings)
    {
        List<List<Finding>> groups = [];
        // Only groups with the same image hash can match, so each finding scans its hash's groups, in order.
        Dictionary<string, List<List<Finding>>> groupsByHash = new(StringComparer.Ordinal);
        foreach (Finding finding in findings)
        {
            if (!groupsByHash.TryGetValue(finding.ImageHash, out List<List<Finding>>? sameHash))
            {
                sameHash = [];
                groupsByHash.Add(finding.ImageHash, sameHash);
            }

            List<Finding>? group = sameHash.FirstOrDefault(candidate => PositionMatch(candidate[0], finding) >= MinimumPositionMatch);
            if (group is null)
            {
                group = [finding];
                groups.Add(group);
                sameHash.Add(group);
            }
            else
            {
                group.Add(finding);
            }
        }

        return groups;
    }

    /// <summary>
    /// The mean of the four corner-coordinate matches, each <c>100 × (1 − |Δ| / extent)</c> over the larger
    /// capture width (x) or height (y), in percent.
    /// </summary>
    public static double PositionMatch(Finding a, Finding b)
    {
        int width = Math.Max(a.CaptureSize.Width, b.CaptureSize.Width);
        int height = Math.Max(a.CaptureSize.Height, b.CaptureSize.Height);
        return (Coordinate(a.Core.Left, b.Core.Left, width)
                + Coordinate(a.Core.Top, b.Core.Top, height)
                + Coordinate(a.Core.Right, b.Core.Right, width)
                + Coordinate(a.Core.Bottom, b.Core.Bottom, height)) / 4.0;
    }

    private static double Coordinate(int left, int right, int extent) =>
        Math.Clamp(100.0 * (1.0 - (Math.Abs(left - right) / (double)Math.Max(1, extent))), 0.0, 100.0);
}
