namespace Parity.Compare.Detection;

/// <summary>
/// Grows a change core into a review crop that shows the surrounding text: across its text line, over a
/// label/value block when the change is a narrow value in such a block, and by a padding. The shape comes
/// only from the ink around the core, never from where the core sits in the capture. The crop always
/// contains the core, so shaping it can show more or less context but never hide a difference.
/// </summary>
internal sealed class CropExpander
{
    private const int ScanPadding = 180;
    private const int LineGap = 36;
    private const int ValueLabelGap = 120;
    private const int SmallValueWidth = 60;
    private const int LineVerticalSlack = 5;
    private const int MaxLineHeight = 32;
    private const int Padding = 12;
    private const int LinePadding = 2;

    public Rectangle Expand(Rectangle core, InkMap ink)
    {
        Rectangle scan = Regions.Inflate(core, ScanPadding, ScanPadding, ink.Size);
        Rectangle line = ExpandAcrossTextLine(core, scan, ink);
        Rectangle grown = KeyValueBlock(core, line, scan, ink) ?? line;
        Rectangle padded = Regions.Inflate(grown, Padding, LinePadding, ink.Size);
        return Rectangle.Union(padded, core);
    }

    private static Rectangle ExpandAcrossTextLine(Rectangle core, Rectangle scan, InkMap ink)
    {
        int centerY = core.Y + (core.Height / 2);
        int bandTop = Math.Max(scan.Y, centerY - LineVerticalSlack);
        int bandBottom = Math.Min(scan.Bottom, centerY + LineVerticalSlack + 1);
        bool[] columnHasInk = new bool[scan.Width];
        for (int x = scan.X; x < scan.Right; x++)
        {
            for (int y = bandTop; y < bandBottom && !columnHasInk[x - scan.X]; y++)
            {
                columnHasInk[x - scan.X] = ink[x, y];
            }
        }

        int leftGap = core.Width <= SmallValueWidth ? ValueLabelGap : LineGap;
        int left = LineEdge(columnHasInk, core.X - scan.X, -1, leftGap) + scan.X;
        int right = LineEdge(columnHasInk, core.Right - 1 - scan.X, 1, LineGap) + scan.X + 1;
        bool[] edges = LongVerticalEdges(ink, left, right, bandTop, bandBottom, scan);
        bool RowHasText(int y)
        {
            for (int x = left; x < right; x++)
            {
                if (ink[x, y] && !edges[x - left])
                {
                    return true;
                }
            }

            return false;
        }

        (int top, int bottom) = NearestInkRowRun(RowHasText, bandTop, bandBottom, centerY);
        // The band only finds the line; a taller line continues past it up to its next blank row.
        top = LineEndRow(RowHasText, top, -1, scan);
        bottom = LineEndRow(RowHasText, bottom, 1, scan);
        return Rectangle.FromLTRB(left, top, right, bottom + 1);
    }

    /// <summary>
    /// The columns of <c>[left, right)</c> whose ink runs through the band for more than
    /// <see cref="MaxLineHeight"/> rows: frames, separators and scroll bars rather than text, so they do
    /// not decide which rows the text line covers.
    /// </summary>
    private static bool[] LongVerticalEdges(InkMap ink, int left, int right, int bandTop, int bandBottom, Rectangle scan)
    {
        bool[] edges = new bool[right - left];
        for (int x = left; x < right; x++)
        {
            for (int y = bandTop; y < bandBottom && !edges[x - left]; y++)
            {
                if (!ink[x, y])
                {
                    continue;
                }

                int top = y;
                int bottom = y;
                while (top > scan.Y && ink[x, top - 1] && bottom - top < MaxLineHeight)
                {
                    top--;
                }

                while (bottom + 1 < scan.Bottom && ink[x, bottom + 1] && bottom - top < MaxLineHeight)
                {
                    bottom++;
                }

                edges[x - left] = bottom - top + 1 > MaxLineHeight;
                y = bottom;
            }
        }

        return edges;
    }

    /// <summary>
    /// The last row with text before the next blank row in <paramref name="direction"/>, or
    /// <paramref name="from"/> when no blank row comes within <see cref="MaxLineHeight"/> rows.
    /// </summary>
    private static int LineEndRow(Func<int, bool> rowHasText, int from, int direction, Rectangle scan)
    {
        for (int step = 1; step <= MaxLineHeight; step++)
        {
            int row = from + (direction * step);
            if (row < scan.Y || row >= scan.Bottom)
            {
                return from;
            }

            if (!rowHasText(row))
            {
                return row - direction;
            }
        }

        return from;
    }

    /// <summary>The last inked column reached from <paramref name="start"/> without crossing a gap wider than allowed.</summary>
    private static int LineEdge(bool[] columnHasInk, int start, int direction, int allowedGap)
    {
        int edge = Math.Clamp(start, 0, columnHasInk.Length - 1);
        int gap = 0;
        for (int x = edge; x >= 0 && x < columnHasInk.Length; x += direction)
        {
            if (columnHasInk[x])
            {
                edge = x;
                gap = 0;
            }
            else if (++gap > allowedGap)
            {
                break;
            }
        }

        return edge;
    }

    /// <summary>The run of rows with text in the band whose center is closest to <paramref name="targetY"/>.</summary>
    private static (int Top, int Bottom) NearestInkRowRun(Func<int, bool> rowHasText, int bandTop, int bandBottom, int targetY)
    {
        List<(int Start, int End)> runs = [];
        int? runStart = null;
        int blankRows = 0;
        for (int y = bandTop; y < bandBottom; y++)
        {
            if (rowHasText(y))
            {
                runStart ??= y;
                blankRows = 0;
                continue;
            }

            if (runStart is not null && ++blankRows > 1)
            {
                runs.Add((runStart.Value, y - blankRows));
                runStart = null;
                blankRows = 0;
            }
        }

        if (runStart is not null)
        {
            runs.Add((runStart.Value, bandBottom - 1 - blankRows));
        }

        return runs.Count == 0
            ? (bandTop, bandBottom - 1)
            : runs.MinBy(run => Math.Abs(run.Start + ((run.End - run.Start) / 2) - targetY));
    }

    /// <summary>
    /// For a narrow change in the label/value columns, the block of at least three consecutive text rows
    /// around it, so a changed value is shown with its neighbors; otherwise null.
    /// </summary>
    private static Rectangle? KeyValueBlock(Rectangle core, Rectangle line, Rectangle scan, InkMap ink)
    {
        if (core.Width > 50 || line.Width > 240)
        {
            return null;
        }

        int left = Math.Max(scan.X, line.X + 18);
        int right = Math.Min(scan.Right, line.Right + 12);
        List<Rectangle> bands = InkRowBands(ink, left, right, scan.Y, scan.Bottom);
        if (bands.Count < 3)
        {
            return null;
        }

        int coreCenter = core.Y + (core.Height / 2);
        int selected = Enumerable.Range(0, bands.Count).MinBy(index => Math.Abs(coreCenter - Center(bands[index])));
        if (Math.Abs(coreCenter - Center(bands[selected])) > 12)
        {
            return null;
        }

        int first = selected;
        while (first > 0 && bands[first].Y - bands[first - 1].Bottom <= 24)
        {
            first--;
        }

        int last = selected;
        while (last + 1 < bands.Count && bands[last + 1].Y - bands[last].Bottom <= 24)
        {
            last++;
        }

        if (last - first + 1 < 3)
        {
            return null;
        }

        return bands.Skip(first).Take(last - first + 1).Aggregate(Rectangle.Union);
    }

    private static int Center(Rectangle band) => band.Y + (band.Height / 2);

    /// <summary>
    /// Text-row bands between <paramref name="top"/> and <paramref name="bottom"/>, separated by at least two
    /// blank rows. A band that runs into <paramref name="top"/> or <paramref name="bottom"/> is left out when
    /// that row is not the capture's edge, because the scan cuts it there.
    /// </summary>
    private static List<Rectangle> InkRowBands(InkMap ink, int left, int right, int top, int bottom)
    {
        List<Rectangle> bands = [];
        int? start = null;
        int minX = right;
        int maxX = left;
        int blankRows = 0;
        for (int y = top; y < bottom; y++)
        {
            int rowMin = right;
            int rowMax = left;
            for (int x = left; x < right; x++)
            {
                if (ink[x, y])
                {
                    rowMin = Math.Min(rowMin, x);
                    rowMax = Math.Max(rowMax, x);
                }
            }

            if (rowMin <= rowMax)
            {
                start ??= y;
                minX = Math.Min(minX, rowMin);
                maxX = Math.Max(maxX, rowMax);
                blankRows = 0;
                continue;
            }

            if (start is not null && ++blankRows > 1)
            {
                bands.Add(new Rectangle(minX, start.Value, maxX - minX + 1, y - start.Value - blankRows + 1));
                start = null;
                minX = right;
                maxX = left;
                blankRows = 0;
            }
        }

        if (start is not null && (blankRows > 0 || bottom == ink.Height))
        {
            bands.Add(new Rectangle(minX, start.Value, maxX - minX + 1, bottom - start.Value - blankRows));
        }

        return bands
            .Where(band => band.Width > 6 && band.Height is >= 3 and <= 20 && (band.Y > top || top == 0))
            .OrderBy(band => band.Y)
            .ToList();
    }
}
