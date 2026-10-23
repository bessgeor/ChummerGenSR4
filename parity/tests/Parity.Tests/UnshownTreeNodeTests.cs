using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Tests;

public sealed class UnshownTreeNodeTests
{
    [Fact]
    public void A_new_node_is_empty_and_has_no_children()
    {
        UnshownTreeNode node = new();

        Assert.Equal("", node.Text);
        Assert.Null(node.Tag);
        Assert.False(node.GrayText);
        Assert.Equal(0, node.Expansions);
        Assert.Empty(node.Children);
    }

    [Fact]
    public void A_node_keeps_what_an_item_fills_it_with()
    {
        UnshownTreeNode node = new();
        ITreeNodeView first = node.NewNode();
        ITreeNodeView second = node.NewNode();
        first.Text = "First";
        second.Tag = "second-id";

        node.Text = "Item";
        node.Tag = "item-id";
        node.ShowAsGrayText();
        node.Add(first);
        node.Expand();
        node.Add(second);
        node.Expand();

        Assert.Equal("Item", node.Text);
        Assert.Equal("item-id", node.Tag);
        Assert.True(node.GrayText);
        Assert.Equal(2, node.Expansions);
        Assert.Equal([first, second], node.Children);
        Assert.Equal("First", first.Text);
        Assert.Equal("second-id", second.Tag);
    }

    [Fact]
    public void New_nodes_are_unshown_nodes_in_no_tree()
    {
        UnshownTreeNode node = new();

        UnshownTreeNode child = Assert.IsType<UnshownTreeNode>(node.NewNode());

        Assert.Empty(node.Children);
        Assert.Equal("", child.Text);
        Assert.False(child.GrayText);
    }

    [Fact]
    public void A_node_of_another_kind_is_not_added()
    {
        UnshownTreeNode node = new();

        Assert.Throws<InvalidCastException>(() => node.Add(new TestTreeNode()));
        Assert.Throws<InvalidCastException>(() => node.Add(null!));

        Assert.Empty(node.Children);
    }
}