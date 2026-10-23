using Chummer;
using Parity.Tests.Fakes;
using OperatingSystem = Chummer.OperatingSystem;

namespace Parity.Tests;

// Only what runs without an application host: creating gear, armor and cyberware reads the language, the options and the data files.
public sealed class EquipmentTests
{
    [Fact]
    public void A_copied_piece_of_gear_fills_its_node_and_a_child_node_per_child_of_the_same_type()
    {
        TestItemCharacter character = new();
        Gear original = new(character) { Name = "Commlink Case", Category = "Electronics" };
        original.Children.Add(new Gear(character) { Name = "Trodes", Category = "Electronics Accessories" });
        original.Children.Add(new Commlink(character) { Name = "Meta Link", Category = "Commlink" });
        original.Children.Add(new OperatingSystem(character) { Name = "Vector Xim", Category = "Commlink Operating System" });
        TestTreeNode node = new();

        Gear copy = new(character);
        copy.Copy(original, node, (weapon, weaponNode) => Assert.Fail("Copying gear adds no weapon."));

        Assert.Equal("Commlink Case", copy.Name);
        Assert.Equal("Commlink Case", node.Text);
        Assert.Equal(copy.InternalId, node.Tag);
        Assert.NotEqual(original.InternalId, copy.InternalId);
        Assert.Equal([typeof(Gear), typeof(Commlink), typeof(OperatingSystem)], copy.Children.Select(child => child.GetType()));
        Assert.Equal(["Trodes", "Meta Link", "Vector Xim"], copy.Children.Select(child => child.Name));
        Assert.Equal(node.Created, node.Children);
        Assert.Equal(["Trodes", "Meta Link", "Vector Xim"], node.Children.Select(child => child.Text));
        Assert.Equal(copy.Children.Select(child => (object)child.InternalId), node.Children.Select(child => child.Tag));
        Assert.Equal(3, node.Expansions);
        Assert.All(node.Children, child => Assert.False(child.Gray));
    }

    [Fact]
    public void A_copied_child_fills_its_own_children_in_its_own_node()
    {
        TestItemCharacter character = new();
        Gear original = new(character) { Name = "Armor Case", Category = "Electronics" };
        Commlink commlink = new(character) { Name = "Meta Link", Category = "Commlink" };
        commlink.Children.Add(new Gear(character) { Name = "Sim Module", Category = "Commlink Accessories" });
        original.Children.Add(commlink);
        TestTreeNode node = new();

        new Gear(character).Copy(original, node, (weapon, weaponNode) => Assert.Fail("Copying gear adds no weapon."));

        TestTreeNode commlinkNode = Assert.Single(node.Children);
        TestTreeNode moduleNode = Assert.Single(commlinkNode.Children);
        Assert.Equal("Sim Module", moduleNode.Text);
        Assert.Empty(node.Created.Skip(1));
        Assert.Equal(1, commlinkNode.Expansions);
    }

    [Fact]
    public void A_piece_of_gear_shows_its_children_to_the_character_view()
    {
        TestItemCharacter character = new();
        Gear skillsoft = new(character) { Name = "Skillwires", Category = "Skillsofts" };
        Gear child = new(character) { Name = "Activesoft", Category = "Skillsofts" };
        skillsoft.Children.Add(child);

        ICharacterGear view = skillsoft;

        Assert.Equal("Skillwires", view.Name);
        Assert.Equal("Skillsofts", view.Category);
        Assert.Same(child, Assert.Single(view.Children));
    }
}
