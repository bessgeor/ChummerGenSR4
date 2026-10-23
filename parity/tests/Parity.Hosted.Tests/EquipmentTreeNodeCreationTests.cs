using System.Windows.Forms;
using System.Xml;
using Chummer;

namespace Parity.Hosted.Tests;

// The app's extension methods give the nodes of included items the context menu of their kind.
public sealed class EquipmentTreeNodeCreationTests : IDisposable
{
    private readonly ContextMenuStrip _vehicle = new() { Name = "vehicle" };
    private readonly ContextMenuStrip _gear = new() { Name = "gear" };
    private readonly ContextMenuStrip _weapon = new() { Name = "weapon" };
    private readonly ContextMenuStrip _accessory = new() { Name = "accessory" };
    private readonly ContextMenuStrip _mod = new() { Name = "mod" };

    public void Dispose()
    {
        _vehicle.Dispose();
        _gear.Dispose();
        _weapon.Dispose();
        _accessory.Dispose();
        _mod.Dispose();
    }

    [Fact]
    public void A_weapon_created_in_a_tree_node_gives_its_underbarrel_weapon_accessories_and_mods_their_context_menus()
    {
        TreeNode node = new();
        Weapon weapon = new(new Character());

        weapon.Create(Load(TestData.Weapons, "/chummer/weapons/weapon[name = 'Test Rifle']"), new Character(), node, _weapon, _accessory, _mod);

        Assert.Equal("Test Rifle", node.Text);
        Assert.Equal(["Test Launcher", "Test Scope", "Test Stock"], node.Nodes.Cast<TreeNode>().Select(child => child.Text));
        Assert.Equal([_weapon, _accessory, _mod], node.Nodes.Cast<TreeNode>().Select(child => child.ContextMenuStrip));
        Assert.Null(node.ContextMenuStrip);
    }

    [Fact]
    public void A_vehicle_created_in_a_tree_node_gives_its_mods_gear_weapons_accessories_and_weapon_mods_their_context_menus()
    {
        TreeNode node = new();
        Vehicle vehicle = new(new Character());

        vehicle.Create(Load(TestData.Car, "/vehicle"), node, _vehicle, _gear, _weapon, _accessory, _mod);

        Assert.Equal("Test Car", node.Text);
        TreeNode[] children = node.Nodes.Cast<TreeNode>().ToArray();
        Assert.Equal(["Weapon Mount, Fixed", "Spoiler", "Weapon Mount, Turret", "2 Test Sensor", "Test Grenades"], children.Select(child => child.Text));
        Assert.Equal([_vehicle, _vehicle, _vehicle, _gear, _gear], children.Select(child => child.ContextMenuStrip));

        TreeNode[] firstMount = children[0].Nodes.Cast<TreeNode>().ToArray();
        TreeNode[] secondMount = children[2].Nodes.Cast<TreeNode>().ToArray();
        Assert.Equal(2, firstMount.Length);
        Assert.Single(secondMount);
        Assert.Equal([_weapon, _weapon, _weapon], firstMount.Concat(secondMount).Select(child => child.ContextMenuStrip));

        TreeNode[] pistolChildren = firstMount[0].Nodes.Cast<TreeNode>().ToArray();
        Assert.Equal(["Test Scope", "Test Stock"], pistolChildren.Select(child => child.Text));
        Assert.Equal([_accessory, _mod], pistolChildren.Select(child => child.ContextMenuStrip));
        Assert.Equal(vehicle.Mods[0].Weapons.Select(granted => granted.InternalId), firstMount.Select(child => (string)child.Tag!));
    }

    private static XmlNode Load(string xml, string xpath)
    {
        XmlDocument document = new();
        document.LoadXml(xml);
        return document.SelectSingleNode(xpath)!;
    }
}
