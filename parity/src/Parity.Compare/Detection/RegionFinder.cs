using Parity.Imaging;

namespace Parity.Compare.Detection;

/// <summary>
/// Turns the raw pixel difference into change regions: 8-connected components of differing pixels,
/// every one kept whatever its size, merged when they lie within <see cref="Regions.MergeGap"/> of each
/// other. The regions' pixel counts add up to the difference's count.
/// </summary>
internal sealed class RegionFinder
{
    private static readonly (int Dx, int Dy)[] Neighbors = [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, 1), (1, -1), (-1, -1)];

    public IReadOnlyList<ChangeRegion> Find(PixelDifference difference)
    {
        int width = difference.Width;
        int height = difference.Height;
        bool[] visited = new bool[width * height];
        List<ChangeRegion> components = [];
        Queue<(int X, int Y)> queue = new();
        for (int y = 0; y < height; y++)
        {
            for (int x = 0; x < width; x++)
            {
                if (!difference[x, y] || visited[(y * width) + x])
                {
                    continue;
                }

                visited[(y * width) + x] = true;
                queue.Enqueue((x, y));
                int left = x, top = y, right = x, bottom = y;
                long pixels = 0;
                while (queue.Count > 0)
                {
                    (int cx, int cy) = queue.Dequeue();
                    pixels++;
                    left = Math.Min(left, cx);
                    top = Math.Min(top, cy);
                    right = Math.Max(right, cx);
                    bottom = Math.Max(bottom, cy);
                    foreach ((int dx, int dy) in Neighbors)
                    {
                        int nx = cx + dx;
                        int ny = cy + dy;
                        if (nx >= 0 && ny >= 0 && nx < width && ny < height && difference[nx, ny] && !visited[(ny * width) + nx])
                        {
                            visited[(ny * width) + nx] = true;
                            queue.Enqueue((nx, ny));
                        }
                    }
                }

                components.Add(new ChangeRegion(Rectangle.FromLTRB(left, top, right + 1, bottom + 1), pixels));
            }
        }

        return Regions.Merge(
            components.OrderBy(region => region.Core.Y).ThenBy(region => region.Core.X),
            region => region.Core,
            ChangeRegion.Combine,
            Regions.MergeGap);
    }
}
