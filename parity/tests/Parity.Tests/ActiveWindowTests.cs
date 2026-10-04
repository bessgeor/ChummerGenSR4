using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class ActiveWindowTests
{
    private static readonly IntPtr Main = 1;
    private static readonly IntPtr Dialog = 2;
    private static readonly IntPtr Nested = 3;

    [Fact]
    public void Enabled_main_window_is_active()
    {
        FakeWindowGraph graph = new() { Enabled = { Main } };

        Assert.Equal(Main, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void Disabled_main_window_gives_its_dialog()
    {
        FakeWindowGraph graph = new() { Enabled = { Dialog }, Popups = { [Main] = Dialog } };

        Assert.Equal(Dialog, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void A_dialog_disabled_by_its_own_dialog_is_followed()
    {
        FakeWindowGraph graph = new() { Enabled = { Nested }, Popups = { [Main] = Dialog, [Dialog] = Nested } };

        Assert.Equal(Nested, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    public void Disabled_window_without_an_enabled_popup_gives_none(int popup)
    {
        // GW_ENABLEDPOPUP returns the window itself when it owns no enabled pop-up.
        FakeWindowGraph graph = new() { Popups = { [Main] = popup } };

        Assert.Equal(IntPtr.Zero, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void A_cycle_of_disabled_windows_gives_none()
    {
        FakeWindowGraph graph = new() { Popups = { [Main] = Dialog, [Dialog] = Main } };

        Assert.Equal(IntPtr.Zero, new ActiveWindowResolver(graph).Resolve(Main));
    }

    private sealed class FakeWindowGraph : IWindowGraph
    {
        public HashSet<IntPtr> Enabled { get; } = [];

        public Dictionary<IntPtr, IntPtr> Popups { get; } = [];

        public bool IsEnabled(IntPtr window) => Enabled.Contains(window);

        public IntPtr EnabledPopup(IntPtr window) => Popups.GetValueOrDefault(window, window);
    }
}
