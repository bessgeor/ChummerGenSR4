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