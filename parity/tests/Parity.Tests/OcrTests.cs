using Parity.Compare.Ocr;
using Parity.Contracts.CompareReport;
using Parity.Imaging;
using Parity.Tests.Fakes;

namespace Parity.Tests;

public sealed class OcrTests
{
    [Fact]
    public void Tesseract_reads_a_line_of_app_text()
    {
        using TesseractOcrEngine engine = new(Path.Combine(AppContext.BaseDirectory, "tessdata"), new OcrImagePreparer());
        using Bitmap crop = CaptureRunFolder.Image(190, 17, graphics =>
        {
            using Font font = new("Microsoft Sans Serif", 8.25f);
            graphics.DrawString("Special Attributes   45 BP", font, Brushes.Black, 2, 1);
        });

        OcrReading reading = engine.Read(ArgbImage.FromBitmap(crop));

        Assert.Equal(OcrStatus.Text, reading.Status);
        Assert.Equal("Special Attributes 45 BP", reading.Text);
    }

    [Fact]
    public void Tesseract_reads_a_blank_crop_as_empty()
    {
        using TesseractOcrEngine engine = new(Path.Combine(AppContext.BaseDirectory, "tessdata"), new OcrImagePreparer());
        using Bitmap crop = CaptureRunFolder.Image(60, 20);

        Assert.Equal(OcrStatus.Empty, engine.Read(ArgbImage.FromBitmap(crop)).Status);
    }

    [Theory]
    [InlineData(0, 10, true)]
    [InlineData(5, 15, true)]
    [InlineData(0, 15, false)]
    public void Only_a_vertical_line_across_the_crop_is_cleared_as_a_border(int top, int bottom, bool kept)
    {
        using Bitmap crop = CaptureRunFolder.Image(40, 15, graphics => graphics.FillRectangle(Brushes.Black, 20, top, 1, bottom - top));

        using Bitmap prepared = new(new MemoryStream(new OcrImagePreparer().Prepare(ArgbImage.FromBitmap(crop))));

        int black = 0;
        foreach (int argb in ArgbImage.FromBitmap(prepared).Pixels)
        {
            black += (argb & 0xFFFFFF) == 0 ? 1 : 0;
        }

        Assert.Equal(kept, black > 0);
    }

    [Fact]
    public void Missing_language_data_fails_to_create_the_engine() =>
        Assert.Throws<FileNotFoundException>(() => new TesseractOcrEngine(Path.Combine(Path.GetTempPath(), Guid.NewGuid().ToString("N")), new OcrImagePreparer()));

    [Theory]
    [InlineData("  Special Attributes 45 BF \r\n\r\n", "Special Attributes 45 BF")]
    [InlineData("Body 4\n  Agility 2", "Body 4\nAgility 2")]
    [InlineData("Nuyen Remaining 439N", "Nuyen Remaining 439N")]
    [InlineData("Nuyen: 11,0258 |", "Nuyen: 11,0258 |")]
    [InlineData("3 EF\n2Y", "3 EF\n2Y")]
    [InlineData("Specal Atributes", "Specal Atributes")]
    public void Ocr_text_is_only_trimmed(string raw, string expected) =>
        Assert.Equal(expected, OcrTextNormalizer.Normalize(raw));
}
