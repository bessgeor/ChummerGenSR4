using Parity.Imaging;

namespace Parity.Capture.Execution;

/// <summary>
/// The share of pixels whose 32-bit ARGB value differs at all between two images, by the shared
/// <see cref="PixelDifference"/>. Images of different sizes differ completely (1.0).
/// </summary>
internal sealed class PixelComparer
{
    public ImageComparison Compare(string leftPath, string rightPath)
    {
        ArgbImage left = ArgbImage.Load(leftPath);
        ArgbImage right = ArgbImage.Load(rightPath);
        double difference = left.Size == right.Size ? PixelDifference.Of(left, right).Ratio : 1.0;
        return new ImageComparison(difference, left.Size, right.Size);
    }
}
