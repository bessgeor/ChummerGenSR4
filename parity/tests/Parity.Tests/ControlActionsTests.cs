using Parity.Capture.Ui;
using Parity.Tests.Fakes;

namespace Parity.Tests;

public sealed class ControlActionsTests
{
    private readonly FakeControlAccess _access = new();
    private readonly ControlActions _actions;
    private readonly ActionContext _context;
    private IntPtr _window = 1;
    private int _settled;

    public ControlActionsTests()
    {
        _actions = new ControlActions(_access);
        _context = new ActionContext(() => _window, () => _window, new DialogSafeCaller(), () => _settled++, 1);
    }

    [Fact]
    public void A_value_is_set_and_the_control_left_with_tab()
    {
        FakeValueBox box = new("1");
        _access.Boxes["nudKarma"] = box;

        _actions.SetValue(_context, "nudKarma", "5");

        Assert.Equal(["focus", "set:5", "tab"], box.Calls);
        Assert.Equal(1, _settled);
    }

    [Fact]
    public void A_value_the_control_already_holds_fails_without_touching_it()
    {
        FakeValueBox box = new("5");
        _access.Boxes["nudKarma"] = box;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SetValue(_context, "nudKarma", "5"));

        Assert.Contains("already holds '5'", error.Message);
        Assert.Empty(box.Calls);
    }

    [Fact]
    public void A_value_the_control_clamps_fails_with_what_it_holds()
    {
        FakeValueBox box = new("1", take => take == "150" ? "99" : take);
        _access.Boxes["nudKarma"] = box;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SetValue(_context, "nudKarma", "150"));

        Assert.Contains("holds '99' after it was set to '150'", error.Message);
    }

    [Fact]
    public void A_value_that_opens_a_dialog_is_not_left_with_tab()
    {
        using ManualResetEventSlim dialogClosed = new();
        FakeValueBox box = new("old");
        _access.Boxes["txtName"] = new BlockingBox(box, () => _window = 2, dialogClosed);
        ActionContext context = new(() => _window, () => _window, new DialogSafeCaller(), () => { }, 1);

        _actions.SetValue(context, "txtName", "x");

        dialogClosed.Set();
        Assert.Equal(["focus", "set:x"], box.Calls);
    }

    [Fact]
    public void A_value_that_opens_a_dialog_and_is_not_taken_fails_with_what_the_control_holds()
    {
        using ManualResetEventSlim dialogClosed = new();
        FakeValueBox box = new("old", take => "old");
        _access.Boxes["txtName"] = new BlockingBox(box, () => _window = 2, dialogClosed);
        ActionContext context = new(() => _window, () => _window, new DialogSafeCaller(), () => { }, 1);

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SetValue(context, "txtName", "x"));

        dialogClosed.Set();
        Assert.Contains("holds 'old' after it was set to 'x'", error.Message);
        Assert.DoesNotContain("tab", box.Calls);
    }

    [Fact]
    public void An_unknown_control_fails_with_the_finders_message()
    {
        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SetValue(_context, "nudNone", "5"));

        Assert.Contains("No enabled control 'nudNone'", error.Message);
    }

    [Fact]
    public void A_button_is_pressed_and_the_app_settled()
    {
        int pressed = 0;
        _access.Presses["cmdOK"] = () => pressed++;

        _actions.Click(_context, "cmdOK");

        Assert.Equal(1, pressed);
        Assert.Equal(1, _settled);
    }

    [Fact]
    public void A_control_that_can_be_neither_invoked_nor_toggled_fails()
    {
        _access.Presses["lblName"] = null;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.Click(_context, "lblName"));

        Assert.Contains("can be neither invoked nor toggled", error.Message);
        Assert.Equal(0, _settled);
    }

    [Fact]
    public void A_click_that_throws_fails_with_its_own_message()
    {
        _access.Presses["cmdOK"] = () => throw new InvalidOperationException("not enabled");

        Assert.Equal("not enabled", Assert.Throws<InvalidOperationException>(() => _actions.Click(_context, "cmdOK")).Message);
    }

    [Fact]
    public void An_item_is_selected()
    {
        FakeItem item = new(selected: false);
        _access.Items["treGear=Armor"] = item;

        _actions.SelectItem(_context, "treGear", "Armor");

        Assert.Equal(1, item.Selections);
        Assert.True(item.IsSelected);
    }

    [Fact]
    public void An_item_that_is_selected_already_fails_without_selecting_it()
    {
        FakeItem item = new(selected: true);
        _access.Items["treGear=Armor"] = item;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SelectItem(_context, "treGear", "Armor"));

        Assert.Contains("already selected", error.Message);
        Assert.Equal(0, item.Selections);
    }

    [Fact]
    public void An_item_that_is_not_selected_afterwards_fails()
    {
        FakeItem item = new(selected: false, selects: false);
        _access.Items["treGear=Armor"] = item;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.SelectItem(_context, "treGear", "Armor"));

        Assert.Contains("is not selected in 'treGear' after selecting it", error.Message);
    }

    [Fact]
    public void A_missing_item_fails_with_the_finders_message()
    {
        Assert.Throws<InvalidOperationException>(() => _actions.SelectItem(_context, "treGear", "Armor"));
    }

    [Fact]
    public void A_menu_item_is_invoked_and_the_menu_stays_as_it_is()
    {
        int invoked = 0;
        FakeMenu menu = new(new MenuEntry("Add Gear", () => invoked++), new MenuEntry("Delete", () => { }));
        _access.Menus["treGear"] = menu;

        _actions.ContextMenu(_context, "treGear", "Add Gear");

        Assert.Equal(1, invoked);
        Assert.False(menu.Closed);
        Assert.Equal(1, _settled);
    }

    [Fact]
    public void A_menu_without_the_item_is_closed_and_the_failure_names_its_items()
    {
        FakeMenu menu = new(new MenuEntry("Delete", () => { }), new MenuEntry("Rename", () => { }));
        _access.Menus["treGear"] = menu;

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.ContextMenu(_context, "treGear", "Add Gear"));

        Assert.True(menu.Closed);
        Assert.Contains("no item 'Add Gear'", error.Message);
        Assert.Contains("'Delete', 'Rename'", error.Message);
        Assert.Equal(0, _settled);
    }

    [Fact]
    public void A_menu_item_that_cannot_be_invoked_closes_the_menu_and_fails()
    {
        FakeMenu menu = new(new MenuEntry("Add Gear", null));
        _access.Menus["treGear"] = menu;

        Assert.Throws<InvalidOperationException>(() => _actions.ContextMenu(_context, "treGear", "Add Gear"));

        Assert.True(menu.Closed);
    }

    [Fact]
    public void A_menu_without_items_says_so()
    {
        _access.Menus["treGear"] = new FakeMenu();

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _actions.ContextMenu(_context, "treGear", "Add Gear"));

        Assert.Contains("it has no items", error.Message);
    }

    /// <summary>A box whose Set opens a dialog: the window changes and the call returns only when the dialog is closed.</summary>
    private sealed class BlockingBox(FakeValueBox inner, Action openDialog, ManualResetEventSlim dialogClosed) : IValueBox
    {
        public string Value => inner.Value;

        public void Focus() => inner.Focus();

        public void Set(string value)
        {
            inner.Set(value);
            openDialog();
            dialogClosed.Wait();
        }

        public void LeaveWithTab() => inner.LeaveWithTab();
    }
}