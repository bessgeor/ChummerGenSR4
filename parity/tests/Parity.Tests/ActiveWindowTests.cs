using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class ActiveWindowTests
{
    private static readonly IntPtr Main = 1;
    private static readonly IntPtr Dialog = 2;
    private static readonly IntPtr Nested = 3;
    private static readonly IntPtr Tool = 4;

    [Fact]
    public void Enabled_main_window_is_active()
    {
        FakeWindowGraph graph = new() { Enabled = { Main }, Owned = { [Main] = [Tool] } };

        Assert.Equal(Main, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void Disabled_main_window_gives_its_topmost_owned_window()
    {
        FakeWindowGraph graph = new() { Enabled = { Dialog, Tool }, Owned = { [Main] = [Dialog, Tool] } };

        Assert.Equal(Dialog, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void A_dialog_disabled_by_its_own_dialog_is_followed()
    {
        FakeWindowGraph graph = new() { Enabled = { Nested }, Owned = { [Main] = [Dialog], [Dialog] = [Nested] } };

        Assert.Equal(Nested, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void Disabled_window_that_shows_no_owned_window_yet_gives_none()
    {
        FakeWindowGraph graph = new();

        Assert.Equal(IntPtr.Zero, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Fact]
    public void A_cycle_of_disabled_windows_gives_none()
    {
        FakeWindowGraph graph = new() { Owned = { [Main] = [Dialog], [Dialog] = [Main] } };

        Assert.Equal(IntPtr.Zero, new ActiveWindowResolver(graph).Resolve(Main));
    }

    [Theory]
    [InlineData("tooltips_class32", true)]
    [InlineData("WindowsForms10.tooltips_class32.app.0.141b42a_r3_ad1", true)]
    [InlineData("WindowsForms10.Window.8.app.0.141b42a_r3_ad1", false)]
    public void A_tooltip_window_is_recognized_by_its_class_name(string className, bool tooltip)
    {
        Assert.Equal(tooltip, Win32WindowGraph.IsTooltipClass(className));
    }

    private sealed class FakeWindowGraph : IWindowGraph
    {
        public HashSet<IntPtr> Enabled { get; } = [];

        public Dictionary<IntPtr, IntPtr[]> Owned { get; } = [];

        public bool IsEnabled(IntPtr window) => Enabled.Contains(window);

        public IReadOnlyList<IntPtr> OwnedWindows(IntPtr owner) => Owned.GetValueOrDefault(owner, []);
    }
}
