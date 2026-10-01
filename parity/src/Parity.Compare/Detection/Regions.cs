namespace Parity.Compare.Detection;

/// <summary>Rectangle helpers; rectangles are clamped to the image they belong to.</summary>
internal static class Regions
{
    /// <summary>Distance up to which differences and crops count as one discrepancy.</summary>
    public const int MergeGap = 18;

    public static Rectangle Inflate(Rectangle region, int paddingX, int paddingY, Size image)
    {
        int left = Math.Max(0, region.X - paddingX);
        int top = Math.Max(0, region.Y - paddingY);
        int right = Math.Min(image.Width, region.Right + paddingX);
        int bottom = Math.Min(image.Height, region.Bottom + paddingY);
        return Rectangle.FromLTRB(left, top, right, bottom);
    }

    public static bool IsNear(Rectangle a, Rectangle b, int gap) =>
        a.X - gap <= b.Right && b.X - gap <= a.Right && a.Y - gap <= b.Bottom && b.Y - gap <= a.Bottom;

    /// <summary>
    /// Merges items whose regions are within <paramref name="gap"/> of each other until no two are. Each
    /// pass sweeps the regions from left to right and joins every near pair; a merged region can reach
    /// another one, so passes repeat until one joins nothing. Members are combined in input order and
    /// a merged item takes the place of its first member, so the result is the same for the same input.
    /// </summary>
    public static List<T> Merge<T>(IEnumerable<T> items, Func<T, Rectangle> region, Func<T, T, T> combine, int gap)
    {
        List<T> current = items.ToList();
        while (true)
        {
            Rectangle[] boxes = current.Select(region).ToArray();
            int[] parent = Enumerable.Range(0, boxes.Length).ToArray();
            bool joined = false;
            List<int> active = [];
            foreach (int index in Enumerable.Range(0, boxes.Length).OrderBy(index => boxes[index].X))
            {
                Rectangle box = boxes[index];
                // Sorted by left edge, a region that ends more than the gap left of this one is near no later region.
                active.RemoveAll(other => boxes[other].Right + gap < box.X);
                foreach (int other in active)
                {
                    joined |= IsNear(boxes[other], box, gap) && Union(parent, other, index);
                }

                active.Add(index);
            }

            if (!joined)
            {
                return current;
            }

            List<T> pass = current;
            current = Enumerable.Range(0, pass.Count)
                .GroupBy(index => Root(parent, index))
                .Select(group => group.Select(index => pass[index]).Aggregate(combine))
                .ToList();
        }
    }

    private static int Root(int[] parent, int index)
    {
        while (parent[index] != index)
        {
            parent[index] = parent[parent[index]];
            index = parent[index];
        }

        return index;
    }

    private static bool Union(int[] parent, int a, int b)
    {
        int rootA = Root(parent, a);
        int rootB = Root(parent, b);
        if (rootA == rootB)
        {
            return false;
        }

        parent[Math.Max(rootA, rootB)] = Math.Min(rootA, rootB);
        return true;
    }
}
