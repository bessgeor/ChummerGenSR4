using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Hosted.Tests;

public sealed class WeaponCreationTests
{
    [Fact]
    public void A_weapon_fills_its_node_and_adds_the_nodes_of_its_underbarrel_weapon_accessories_and_mods_in_that_order()
    {
        NodeFactories factories = new();
        TestTreeNode node = new();
        Weapon weapon = new(new TestItemCharacter());

        weapon.Create(Element(TestData.Weapons, "weapon[name = 'Test Rifle']"), new TestItemCharacter(), node, factories.For("weapon"), factories.For("accessory"), factories.For("mod"));

        Assert.Equal("Test Rifle", node.Text);
        Assert.Equal(weapon.InternalId, node.Tag);
        Assert.Equal(["weapon", "accessory", "mod"], factories.Kinds);
        Assert.Equal(factories.Made.Select(made => made.Node), node.Children);
        Assert.Equal(["Test Launcher", "Test Scope", "Test Stock"], node.Children.Select(child => child.Text));
        Assert.Equal(
            weapon.UnderbarrelWeapons.Select(underbarrel => underbarrel.InternalId)
                .Concat(weapon.WeaponAccessories.Select(accessory => accessory.InternalId))
                .Concat(weapon.WeaponMods.Select(mod => mod.InternalId)),
            node.Children.Select(child => child.Tag));
        Assert.Equal(2, node.Expansions);
        Assert.Empty(node.Created);
        Assert.All(node.Children, child => Assert.False(child.Gray));
    }

    [Fact]
    public void A_weapon_without_children_makes_no_node_for_its_included_items()
    {
        NodeFactories factories = new();
        TestTreeNode node = new();
        Weapon weapon = new(new TestItemCharacter());

        weapon.Create(Element(TestData.Weapons, "weapon[name = 'Test Rifle']"), new TestItemCharacter(), node, factories.For("weapon"), factories.For("accessory"), factories.For("mod"), false);

        Assert.Equal("Test Rifle", node.Text);
        Assert.Empty(factories.Made);
        Assert.Empty(node.Children);
        Assert.Empty(weapon.UnderbarrelWeapons);
        Assert.Empty(weapon.WeaponAccessories);
        Assert.Empty(weapon.WeaponMods);
    }

    private static XmlNode Element(string xml, string xpath)
    {
        XmlDocument document = new();
        document.LoadXml(xml);
        return document.SelectSingleNode("/chummer/weapons/" + xpath)!;
    }
}
