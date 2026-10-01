using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Parity.Imaging;

namespace Parity.Compare.Ocr;

/// <summary>
/// Prepares a crop for OCR: scaled up 4× with bicubic interpolation onto a white margin, thresholded to
/// black and white, and cleared of long lines that frame the text (control borders). Returns PNG bytes.
/// </summary>
internal sealed class OcrImagePreparer
{
    private const int Scale = 4;
    private const int Margin = Scale * 6;
    private const int InkThreshold = 210;

    public byte[] Prepare(ArgbImage crop)
    {
        using Bitmap source = crop.ToBitmap();
        using Bitmap prepared = new(crop.Width * Scale + (Margin * 2), crop.Height * Scale + (Margin * 2), PixelFormat.Format24bppRgb);
        using (Graphics graphics = Graphics.FromImage(prepared))
        {
            graphics.Clear(Color.White);
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.PixelOffsetMode = PixelOffsetMode.HighQuality;
            using ImageAttributes clampEdges = new();
            clampEdges.SetWrapMode(WrapMode.TileFlipXY);
            graphics.DrawImage(
                source,
                new Rectangle(Margin, Margin, crop.Width * Scale, crop.Height * Scale),
                0, 0, crop.Width, crop.Height,
                GraphicsUnit.Pixel,
                clampEdges);
        }

        bool[] black = Threshold(prepared);
        RemoveLines(black, prepared.Width, prepared.Height);
        using Bitmap result = ToBitmap(black, prepared.Width, prepared.Height);
        using MemoryStream png = new();
        result.Save(png, ImageFormat.Png);
        return png.ToArray();
    }

    private static bool[] Threshold(Bitmap bitmap)
    {
        ArgbImage image = ArgbImage.FromBitmap(bitmap);
        ReadOnlySpan<int> pixels = image.Pixels;
        bool[] black = new bool[pixels.Length];
        for (int index = 0; index < pixels.Length; index++)
        {
            int argb = pixels[index];
            int gray = ((((argb >> 16) & 0xFF) * 299) + (((argb >> 8) & 0xFF) * 587) + ((argb & 0xFF) * 114)) / 1000;
            black[index] = gray < InkThreshold;
        }

        return black;
    }

    /// <summary>
    /// Clears thin black components that span most of the image or run across the drawn crop: a vertical
    /// line must reach both its top and its bottom edge, so a glyph stem that reaches one edge stays.
    /// </summary>
    private static void RemoveLines(bool[] black, int width, int height)
    {
        bool[] visited = new bool[black.Length];
        Queue<int> queue = new();
        List<int> component = [];
        for (int start = 0; start < black.Length; start++)
        {
            if (visited[start] || !black[start])
            {
                continue;
            }

            component.Clear();
            visited[start] = true;
            queue.Enqueue(start);
            int left = width, top = height, right = 0, bottom = 0;
            while (queue.Count > 0)
            {
                int index = queue.Dequeue();
                component.Add(index);
                int x = index % width;
                int y = index / width;
                left = Math.Min(left, x);
                right = Math.Max(right, x);
                top = Math.Min(top, y);
                bottom = Math.Max(bottom, y);
                Visit(x + 1 < width ? index + 1 : -1);
                Visit(x > 0 ? index - 1 : -1);
                Visit(y + 1 < height ? index + width : -1);
                Visit(y > 0 ? index - width : -1);
            }

            int componentWidth = right - left + 1;
            int componentHeight = bottom - top + 1;
            // The crop is drawn inside the white margin, so its own border lies Margin pixels in.
            bool crossesTopToBottom = top <= Margin + Scale && bottom >= height - Margin - Scale - 1;
            bool touchesLeftOrRight = left <= Margin + Scale || right >= width - Margin - Scale - 1;
            bool isVerticalLine = componentWidth <= Math.Max(2, Scale * 2) && componentHeight >= Scale * 5
                && (crossesTopToBottom || componentHeight >= height * 0.65);
            bool isHorizontalLine = componentHeight <= Math.Max(2, Scale * 2) && componentWidth >= Scale * 8
                && (touchesLeftOrRight || componentWidth >= width * 0.65);
            if (isVerticalLine || isHorizontalLine)
            {
                component.ForEach(index => black[index] = false);
            }
        }

        void Visit(int index)
        {
            if (index >= 0 && black[index] && !visited[index])
            {
                visited[index] = true;
                queue.Enqueue(index);
            }
        }
    }

    private static Bitmap ToBitmap(bool[] black, int width, int height)
    {
        Bitmap bitmap = new(width, height, PixelFormat.Format24bppRgb);
        BitmapData data = bitmap.LockBits(new Rectangle(0, 0, width, height), ImageLockMode.WriteOnly, PixelFormat.Format24bppRgb);
        try
        {
            byte[] row = new byte[Math.Abs(data.Stride)];
            for (int y = 0; y < height; y++)
            {
                for (int x = 0; x < width; x++)
                {
                    byte value = black[(y * width) + x] ? (byte)0 : (byte)255;
                    row[x * 3] = value;
                    row[(x * 3) + 1] = value;
                    row[(x * 3) + 2] = value;
                }

                Marshal.Copy(row, 0, IntPtr.Add(data.Scan0, y * data.Stride), row.Length);
            }
        }
        finally
        {
            bitmap.UnlockBits(data);
        }

        return bitmap;
    }
}
