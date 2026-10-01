using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class PointerParkerTests
{
    [Fact]
    public void Spot_is_the_middle_of_the_title_bar()
    {
        Assert.Equal(new Point(960, 17), PointerParker.SpotFor(new Rectangle(0, 0, 1920, 1020), 34));
        Assert.Equal(new Point(-1270, 115), PointerParker.SpotFor(new Rectangle(-1920, 100, 1301, 600), 30));
    }
}
