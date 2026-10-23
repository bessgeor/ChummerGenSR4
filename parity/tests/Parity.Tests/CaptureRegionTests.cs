using System.Drawing;
using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class CaptureRegionTests
{
    [Fact]
    public void Maximized_window_drops_the_invisible_borders()
    {
        // 100 % scaling: the window rectangle reaches 8 px past each screen edge.
        Rectangle window = Rectangle.FromLTRB(-8, -8, 1928, 1048);

        Rectangle region = CaptureRegion.Map(window, window.Size, new Rectangle(0, 0, 1920, 1040));

        Assert.Equal(new Rectangle(8, 8, 1920, 1040), region);
    }

    [Fact]
    public void Dpi_unaware_window_maps_to_its_logical_rendering()
    {
        // 150 % scaling: the window measures itself as (-8, -8, 1288, 688) and PrintWindow renders that size.
        Rectangle window = Rectangle.FromLTRB(-12, -12, 1932, 1032);

        Rectangle region = CaptureRegion.Map(window, new Size(1296, 696), new Rectangle(0, 0, 1920, 1020));

        Assert.Equal(new Rectangle(8, 8, 1280, 680), region);
    }

    [Fact]
    public void Restored_window_keeps_its_offset_inside_the_rendering()
    {
        Rectangle window = Rectangle.FromLTRB(93, 43, 907, 657);

        Rectangle region = CaptureRegion.Map(window, window.Size, Rectangle.FromLTRB(100, 50, 900, 650));

        Assert.Equal(new Rectangle(7, 7, 800, 600), region);
    }

    [Fact]
    public void Visible_bounds_outside_the_window_fail()
    {
        Rectangle window = new(0, 0, 100, 100);

        Assert.Throws<InvalidOperationException>(() => CaptureRegion.Map(window, window.Size, new Rectangle(50, 50, 100, 100)));
    }
}
