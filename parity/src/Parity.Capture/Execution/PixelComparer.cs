using System.Drawing.Imaging;
using System.Runtime.InteropServices;

namespace Parity.Capture.Execution;

/// <summary>
/// The share of pixels whose 32-bit ARGB value differs at all between two images. Images of
/// different sizes differ completely (1.0).
/// </summary>
internal sealed class PixelComparer
{
    public ImageComparison Compare(string leftPath, string rightPath)
    {
        using Bitmap left = new(leftPath);
        using Bitmap right = new(rightPath);
        Size leftSize = left.Size;
        Size rightSize = right.Size;
        double difference = leftSize == rightSize ? Difference(left, right) : 1.0;
        return new ImageComparison(difference, leftSize, rightSize);
    }

    private static double Difference(Bitmap left, Bitmap right)
    {
        using Bitmap normalizedLeft = Normalize(left);
        using Bitmap normalizedRight = Normalize(right);
        Rectangle area = new(Point.Empty, left.Size);
        BitmapData leftData = normalizedLeft.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        BitmapData rightData = normalizedRight.LockBits(area, ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
        try
        {
            int length = Math.Abs(leftData.Stride) * left.Height;
            byte[] leftBytes = new byte[length];
            byte[] rightBytes = new byte[length];
            Marshal.Copy(leftData.Scan0, leftBytes, 0, length);
            Marshal.Copy(rightData.Scan0, rightBytes, 0, length);
            long differing = 0;
            for (int offset = 0; offset < length; offset += 4)
            {
                if (leftBytes[offset] != rightBytes[offset]
                    || leftBytes[offset + 1] != rightBytes[offset + 1]
                    || leftBytes[offset + 2] != rightBytes[offset + 2]
                    || leftBytes[offset + 3] != rightBytes[offset + 3])
                {
                    differing++;
                }
            }

            return differing / (double)((long)left.Width * left.Height);
        }
        finally
        {
            normalizedLeft.UnlockBits(leftData);
            normalizedRight.UnlockBits(rightData);
        }
    }

    /// <summary>Draws the image onto a 32-bit ARGB canvas so both sides are compared in the same format.</summary>
    private static Bitmap Normalize(Bitmap source)
    {
        Bitmap normalized = new(source.Width, source.Height, PixelFormat.Format32bppArgb);
        using Graphics graphics = Graphics.FromImage(normalized);
        graphics.DrawImageUnscaled(source, 0, 0);
        return normalized;
    }
}
