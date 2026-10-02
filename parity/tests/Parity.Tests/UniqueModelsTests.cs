using System.Text;
using System.Xml;
using Chummer;
using Parity.Tests.Fakes;
using Attribute = Chummer.Attribute;

namespace Parity.Tests;

// Only what runs without an application host: the items' display names, prints and costs read the language and the options.
public sealed class UniqueModelsTests
{
    [Fact]
    public void A_contact_without_a_colour_saves_zero_and_loads_it_as_its_colour()
    {
        Contact contact = new(new TestItemCharacter());
        Assert.Null(contact.ColourArgb);

        XmlNode saved = Save(contact);

        Assert.Equal("0", saved["colour"]!.InnerText);
        Contact loaded = new(new TestItemCharacter());
        loaded.Load(saved);
        Assert.Equal(0, loaded.ColourArgb);
    }

    [Fact]
    public void A_contact_saves_and_loads_its_colour_as_an_ARGB_value()
    {
        int colour = unchecked((int)0xFF336699);
        Contact contact = new(new TestItemCharacter()) { ColourArgb = colour };

        XmlNode saved = Save(contact);

        Assert.Equal(colour.ToString(), saved["colour"]!.InnerText);
        Contact loaded = new(new TestItemCharacter());
        loaded.Load(saved);
        Assert.Equal(colour, loaded.ColourArgb);
    }

    [Fact]
    public void A_contact_saved_without_a_colour_has_none()
    {
        XmlDocument document = new();
        document.LoadXml("<contact><name>Fixer</name><connection>3</connection><loyalty>2</loyalty><type>Contact</type></contact>");
        Contact loaded = new(new TestItemCharacter());

        loaded.Load(document.DocumentElement!);

        Assert.Null(loaded.ColourArgb);
        Assert.Equal("Fixer", loaded.Name);
    }

    [Theory]
    [InlineData("BOD", true)]
    [InlineData("AGI", true)]
    [InlineData("STR", true)]
    [InlineData("LOG", false)]
    public void A_cyberlimb_in_a_limb_slot_modifies_the_physical_attributes(string strAbbrev, bool blnModified)
    {
        TestItemCharacter character = new();
        character.CyberwareList.Add(new TestCyberware("Cyberlimb", "arm", 5, 5, 5));
        Attribute attribute = new(strAbbrev) { _objCharacter = character };

        Assert.Equal(blnModified, attribute.HasModifiers);
    }

    [Fact]
    public void Cyberware_that_is_no_cyberlimb_or_has_no_limb_slot_does_not_modify_an_attribute()
    {
        TestItemCharacter character = new();
        character.CyberwareList.Add(new TestCyberware("Cyberlimb", "", 5, 5, 5));
        character.CyberwareList.Add(new TestCyberware("Bodyware", "arm", 5, 5, 5));
        Attribute attribute = new("BOD") { _objCharacter = character };

        Assert.False(attribute.HasModifiers);
    }

    [Fact]
    public void An_attribute_adds_up_its_enabled_improvements()
    {
        TestItemCharacter character = new();
        character.Improvements.Add(AttributeImprovement("LOG", intMinimum: 1, intMaximum: 2, intAugmented: 1, intRating: 2));
        character.Improvements.Add(AttributeImprovement("LOG", intMinimum: 1, intMaximum: 1, intAugmented: 0, intRating: 1));
        character.Improvements.Add(AttributeImprovement("WIL", intMinimum: 5, intMaximum: 5, intAugmented: 5, intRating: 1));
        Improvement disabled = AttributeImprovement("LOG", intMinimum: 7, intMaximum: 7, intAugmented: 7, intRating: 1);
        disabled.Enabled = false;
        character.Improvements.Add(disabled);
        Attribute attribute = new("LOG") { _objCharacter = character };

        Assert.Equal(3, attribute.MinimumModifiers);
        Assert.Equal(5, attribute.MaximumModifiers);
        Assert.True(attribute.HasModifiers);
    }

    private static Improvement AttributeImprovement(string strName, int intMinimum, int intMaximum, int intAugmented, int intRating) => new()
    {
        ImproveType = Improvement.ImprovementType.Attribute,
        ImprovedName = strName,
        Minimum = intMinimum,
        Maximum = intMaximum,
        Augmented = intAugmented,
        Rating = intRating,
        Enabled = true,
    };

    private static XmlNode Save(Contact contact)
    {
        StringBuilder text = new();
        using (XmlTextWriter writer = new(new StringWriter(text)))
            contact.Save(writer);
        XmlDocument document = new();
        document.LoadXml(text.ToString());
        return document.DocumentElement!;
    }
}
