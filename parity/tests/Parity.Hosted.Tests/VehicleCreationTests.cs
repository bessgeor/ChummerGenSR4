using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Hosted.Tests;

public sealed class VehicleCreationTests
{
    [Fact]
    public void A_vehicle_adds_the_nodes_of_its_mods_and_gear_to_its_node_and_each_weapon_to_the_node_of_a_free_weapon_mount()
    {
        NodeFactories factories = new();
        TestTreeNode node = new();
        Vehicle vehicle = new(new TestItemCharacter());

        Create(vehicle, node, factories);

        Assert.Equal("Test Car", node.Text);
        Assert.Equal(vehicle.InternalId, node.Tag);
        Assert.Equal(["mod", "mod", "mod", "gear", "gear", "weapon", "accessory", "weapon mod", "weapon", "weapon"], factories.Kinds);
        TestTreeNode[] mods = factories.Nodes("mod").ToArray();
        TestTreeNode[] gear = factories.Nodes("gear").ToArray();
        TestTreeNode[] weapons = factories.Nodes("weapon").ToArray();
        Assert.Equal([.. mods, .. gear], node.Children);
        Assert.Equal(["Weapon Mount, Fixed", "Spoiler", "Weapon Mount, Turret"], mods.Select(mod => mod.Text));
        Assert.Equal(vehicle.Mods.Select(mod => mod.InternalId), mods.Select(mod => (string)mod.Tag!));
        Assert.All(mods, mod => Assert.True(mod.Gray));
        Assert.All(gear, piece => Assert.False(piece.Gray));
        Assert.Equal(vehicle.Gear.Select(piece => piece.InternalId), gear.Select(piece => (string)piece.Tag!));
        Assert.Equal(5, node.Expansions);

        // The first weapon takes the first free mount, the second the next one, and the third, with none free left, the first mount again.
        Assert.Equal([weapons[0], weapons[2]], mods[0].Children);
        Assert.Empty(mods[1].Children);
        Assert.Equal([weapons[1]], mods[2].Children);
        Assert.Equal(2, mods[0].Expansions);
        Assert.Equal(1, mods[2].Expansions);
        Assert.Equal(vehicle.Mods[0].Weapons.Select(weapon => weapon.InternalId), mods[0].Children.Select(child => (string)child.Tag!));
        Assert.Equal(vehicle.Mods[2].Weapons.Select(weapon => weapon.InternalId), mods[2].Children.Select(child => (string)child.Tag!));
        Assert.All(vehicle.Mods.SelectMany(mod => mod.Weapons), weapon => Assert.True(weapon.VehicleMounted));

        // The accessory and the mod of the first weapon hang under its node.
        Assert.Equal([.. factories.Nodes("accessory"), .. factories.Nodes("weapon mod")], weapons[0].Children);
        Assert.Equal(["Test Scope", "Test Stock"], weapons[0].Children.Select(child => child.Text));
        Assert.Equal(2, weapons[0].Expansions);
        Assert.Empty(weapons[1].Children);
    }

    [Fact]
    public void A_vehicle_marks_the_weapons_that_its_gear_grants_as_mounted_on_a_vehicle()
    {
        NodeFactories factories = new();
        TestTreeNode node = new();
        Vehicle vehicle = new(new TestItemCharacter());

        Create(vehicle, node, factories);

        TestTreeNode grenades = factories.Nodes("gear").Last();
        Assert.Equal("Test Grenades", grenades.Text);
        TestTreeNode grantedNode = Assert.Single(grenades.Created);
        TestWeapon granted = HostedApplication.Host.CreatedWeapon((string)grantedNode.Tag!);
        Assert.Equal("Test Grenade", granted.Name);
        Assert.True(granted.VehicleMounted);
        Assert.True(grantedNode.Gray);
        Assert.Empty(grenades.Children);
    }

    [Fact]
    public void A_vehicle_without_children_makes_no_node_for_its_mods_gear_and_weapons()
    {
        NodeFactories factories = new();
        TestTreeNode node = new();
        Vehicle vehicle = new(new TestItemCharacter());

        vehicle.Create(Car(), node, factories.For("mod"), factories.For("gear"), factories.For("weapon"), factories.For("accessory"), factories.For("weapon mod"), false);

        Assert.Equal("Test Car", node.Text);
        Assert.Empty(factories.Made);
        Assert.Empty(node.Children);
        Assert.Empty(vehicle.Mods);
        Assert.Empty(vehicle.Gear);
        Assert.Empty(vehicle.Weapons);
    }

    private static void Create(Vehicle vehicle, TestTreeNode node, NodeFactories factories) =>
        vehicle.Create(Car(), node, factories.For("mod"), factories.For("gear"), factories.For("weapon"), factories.For("accessory"), factories.For("weapon mod"));

    private static XmlNode Car()
    {
        XmlDocument document = new();
        document.LoadXml(TestData.Car);
        return document.DocumentElement!;
    }
}
