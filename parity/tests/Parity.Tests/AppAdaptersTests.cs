using System.Drawing;
using System.Windows.Forms;
using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Tests;

// The app's adapters for the character's items; the items' own display names and prints need the application host.
public sealed class AppAdaptersTests
{
    [Fact]
    public void A_tree_node_view_reads_and_sets_the_text_and_tag_of_its_node()
    {
        TreeNode node = new("before") { Tag = "old" };
        ITreeNodeView view = new TreeNodeView(node);

        Assert.Equal("before", view.Text);
        Assert.Equal("old", view.Tag);

        view.Text += " (Edge)";
        view.Tag = "7f3c";

        Assert.Equal("before (Edge)", node.Text);
        Assert.Equal("7f3c", node.Tag);
    }

    [Fact]
    public void A_tree_node_view_shows_its_node_in_the_system_grey_text_colour_only_when_asked()
    {
        TreeNode node = new("Quality");
        ITreeNodeView view = new TreeNodeView(node);

        Assert.Equal(Color.Empty, node.ForeColor);

        view.ShowAsGrayText();

        Assert.Equal(SystemColors.GrayText, node.ForeColor);
    }

    [Fact]
    public void A_tree_node_view_creates_nodes_in_no_tree_and_adds_them_as_its_last_children()
    {
        TreeNode node = new("Armor");
        node.Nodes.Add(new TreeNode("Existing"));
        TreeNodeView view = new(node);

        TreeNodeView first = Assert.IsType<TreeNodeView>(view.NewNode());
        TreeNodeView second = Assert.IsType<TreeNodeView>(view.NewNode());

        Assert.Null(first.Node.Parent);
        Assert.NotSame(first.Node, second.Node);
        Assert.Equal("", first.Text);
        Assert.Null(first.Tag);
        Assert.Equal(Color.Empty, first.Node.ForeColor);
        Assert.Single(node.Nodes);

        first.Text = "Gel Packs";
        view.Add(first);
        view.Add(second);

        Assert.Equal(["Existing", "Gel Packs", ""], node.Nodes.Cast<TreeNode>().Select(child => child.Text));
        Assert.Same(node, first.Node.Parent);
    }

    [Fact]
    public void A_tree_node_view_adds_only_tree_node_views()
    {
        TreeNodeView view = new(new TreeNode("Armor"));

        Assert.Throws<InvalidCastException>(() => view.Add(new TestTreeNode()));
        Assert.Empty(view.Node.Nodes);
    }

    [Fact]
    public void A_tree_node_view_expands_its_node()
    {
        TreeNode node = new("Armor");
        node.Nodes.Add(new TreeNode("Mod"));
        ITreeNodeView view = new TreeNodeView(node);
        Assert.False(node.IsExpanded);

        view.Expand();

        Assert.True(node.IsExpanded);
    }

    [Fact]
    public void Granted_weapon_lists_add_the_node_and_then_the_weapon()
    {
        List<TestWeapon> weapons = [];
        List<TreeNode> nodes = [];
        Action<IEquipmentWeapon, ITreeNodeView> addWeapon = GrantedWeaponLists.Add(weapons, nodes);
        TestWeapon spur = new("Spur");
        TestWeapon blade = new("Hand Blade");
        TreeNode spurNode = new("Spur");
        TreeNode bladeNode = new("Hand Blade");

        addWeapon(spur, new TreeNodeView(spurNode));
        addWeapon(blade, new TreeNodeView(bladeNode));

        Assert.Equal([spur, blade], weapons);
        Assert.Equal([spurNode, bladeNode], nodes);
    }

    [Fact]
    public void Granted_weapon_lists_that_are_missing_fail_when_a_weapon_is_added_as_before()
    {
        Action<IEquipmentWeapon, ITreeNodeView> addWeapon = GrantedWeaponLists.Add<TestWeapon>(null!, null!);

        Assert.Throws<NullReferenceException>(() => addWeapon(new TestWeapon("Spur"), new TreeNodeView(new TreeNode())));
    }

    [Fact]
    public void Granted_weapon_lists_take_only_tree_node_views_and_weapons_of_their_type()
    {
        List<TestWeapon> weapons = [];
        List<TreeNode> nodes = [];
        Action<IEquipmentWeapon, ITreeNodeView> addWeapon = GrantedWeaponLists.Add(weapons, nodes);

        Assert.Throws<InvalidCastException>(() => addWeapon(new TestWeapon("Spur"), new TestTreeNode()));
        Assert.Empty(nodes);
        Assert.Throws<InvalidCastException>(() => addWeapon(new OtherWeapon(), new TreeNodeView(new TreeNode())));
        Assert.Single(nodes);
        Assert.Empty(weapons);
    }

    [Fact]
    public void Included_armor_mods_get_a_new_node_with_the_context_menu_in_a_tree_node_view()
    {
        using ContextMenuStrip menu = new();
        Func<ITreeNodeView> createNode = ArmorModNodes.Create(menu);

        TreeNodeView first = Assert.IsType<TreeNodeView>(createNode());
        TreeNodeView second = Assert.IsType<TreeNodeView>(createNode());

        Assert.NotSame(first.Node, second.Node);
        Assert.Same(menu, first.Node.ContextMenuStrip);
        Assert.Same(menu, second.Node.ContextMenuStrip);
        Assert.Null(first.Node.Parent);
        Assert.Equal("", first.Text);
    }

    [Fact]
    public void A_contact_without_a_colour_gives_the_empty_colour()
    {
        Contact contact = new(new TestItemCharacter());

        Assert.Equal(Color.Empty, contact.GetColour());
    }

    [Fact]
    public void A_colour_set_on_a_contact_comes_back_with_the_same_ARGB_value()
    {
        Contact contact = new(new TestItemCharacter());
        Color picked = Color.FromArgb(0xFF, 0x33, 0x66, 0x99);

        contact.SetColour(picked);

        Assert.Equal(picked.ToArgb(), contact.ColourArgb);
        Assert.Equal(picked.ToArgb(), contact.GetColour().ToArgb());
    }

    [Fact]
    public void The_empty_colour_clears_a_contacts_colour()
    {
        Contact contact = new(new TestItemCharacter());
        contact.SetColour(Color.Red);

        contact.SetColour(Color.Empty);

        Assert.Null(contact.ColourArgb);
        Assert.Equal(Color.Empty, contact.GetColour());
    }

    [Fact]
    public void A_weapon_function_creates_each_weapon_with_a_grey_node_and_adds_both_to_the_lists()
    {
        List<string> weapons = [];
        List<TreeNode> nodes = [];
        List<XmlNode> created = [];
        XmlDocument document = new();
        document.LoadXml("<weapons><weapon><name>Bite</name></weapon><weapon><name>Claw</name></weapon></weapons>");
        Func<XmlNode, string> addWeapon = WeaponNodeFunction.Create<string>(
            (xml, node) =>
            {
                created.Add(xml);
                Assert.Equal(Color.Empty, node.ForeColor);
                node.Text = xml["name"]!.InnerText;
                return "id-" + node.Text;
            },
            id => id,
            weapons,
            nodes);

        string first = addWeapon(document.DocumentElement!.ChildNodes[0]!);
        string second = addWeapon(document.DocumentElement!.ChildNodes[1]!);

        Assert.Equal("id-Bite", first);
        Assert.Equal("id-Claw", second);
        Assert.Equal(["id-Bite", "id-Claw"], weapons);
        Assert.Equal(["Bite", "Claw"], nodes.Select(node => node.Text));
        Assert.All(nodes, node => Assert.Equal(SystemColors.GrayText, node.ForeColor));
        Assert.Equal(document.DocumentElement.ChildNodes.Cast<XmlNode>(), created);
    }
}