using System.Globalization;
using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Tests;

// Every manager here gets its dialogs directly, so no test reads the application host, the language or the data files.
public sealed class ImprovementManagerTests
{
    [Fact]
    public void A_selected_text_becomes_a_text_improvement()
    {
        TestCharacter character = new();
        TestDialogs dialogs = new() { Text = "Pollen" };
        ImprovementManager manager = new(character, dialogs);

        bool created = manager.CreateImprovements(Improvement.ImprovementSource.Quality, "Allergy", Bonus("<selecttext />"));

        Assert.True(created);
        Assert.Equal("Pollen", manager.SelectedValue);
        Improvement improvement = Assert.Single(character.Improvements);
        Assert.Equal(Improvement.ImprovementType.Text, improvement.ImproveType);
        Assert.Equal("Pollen", improvement.ImprovedName);
        Assert.Equal("Allergy", improvement.SourceName);
        Assert.Equal(["SelectText(Allergy, )"], dialogs.Calls);
    }

    [Fact]
    public void A_cancelled_selection_rolls_back_the_bonus()
    {
        TestCharacter character = new();
        TestDialogs dialogs = new();
        ImprovementManager manager = new(character, dialogs);

        bool created = manager.CreateImprovements(
            Improvement.ImprovementSource.Quality,
            "Latent Awakening",
            Bonus("<addattribute><name>MAG</name></addattribute><enabletab><name>adept</name></enabletab><selectskill />"));

        Assert.False(created);
        Assert.Empty(character.Improvements);
        Assert.False(character.MAGEnabled);
        Assert.False(character.AdeptEnabled);
        Assert.Equal(["SelectSkill(, , , , Latent Awakening, )"], dialogs.Calls);
    }

    [Fact]
    public void Removing_a_source_disables_MAG_only_when_no_other_source_enables_it()
    {
        TestCharacter character = new();
        ImprovementManager manager = new(character, new TestDialogs());
        XmlNode bonus = Bonus("<addattribute><name>MAG</name></addattribute>");
        Assert.True(manager.CreateImprovements(Improvement.ImprovementSource.Quality, "Magician", bonus));
        Assert.True(manager.CreateImprovements(Improvement.ImprovementSource.Metatype, "Dragon", bonus));

        manager.RemoveImprovements(Improvement.ImprovementSource.Quality, "Magician");

        Assert.True(character.MAGEnabled);
        Assert.Equal("Dragon", Assert.Single(character.Improvements).SourceName);

        manager.RemoveImprovements(Improvement.ImprovementSource.Metatype, "Dragon");

        Assert.False(character.MAGEnabled);
        Assert.Empty(character.Improvements);
    }

    [Fact]
    public void A_forced_skill_is_passed_to_the_dialog_with_the_bonus_filter()
    {
        TestCharacter character = new();
        character.SkillList.Add(new TestSkill("Automatics", ""));
        character.SkillList.Add(new TestSkill("Pistols", ""));
        TestDialogs dialogs = new() { Skill = "Pistols" };
        ImprovementManager manager = new(character, dialogs) { ForcedValue = "Pistols" };

        bool created = manager.CreateImprovements(Improvement.ImprovementSource.Power, "Improved Ability", Bonus("<selectskill skillgroup=\"Firearms\"><val>2</val></selectskill>"));

        Assert.True(created);
        Assert.Equal(["SelectSkill(Firearms, , , , Improved Ability, Pistols)"], dialogs.Calls);
        Improvement improvement = Assert.Single(character.Improvements);
        Assert.Equal(Improvement.ImprovementType.Skill, improvement.ImproveType);
        Assert.Equal("Pistols", improvement.ImprovedName);
        Assert.Equal(2, improvement.Value);
    }

    [Fact]
    public void Removing_the_last_Adapsin_improvement_converts_the_grades()
    {
        TestCharacter character = new();
        ImprovementManager manager = new(character, new TestDialogs());
        Assert.True(manager.CreateImprovements(Improvement.ImprovementSource.Cyberware, "Adapsin", Bonus("<adapsin />")));

        manager.RemoveImprovements(Improvement.ImprovementSource.Cyberware, "Adapsin");

        Assert.Empty(character.Improvements);
        Assert.Equal(1, character.AdapsinConversions);
    }

    [Fact]
    public void ValueOf_adds_values_and_takes_the_highest_of_a_unique_name()
    {
        TestCharacter character = new();
        ImprovementManager manager = new(character, new TestDialogs());
        manager.CreateImprovement("", Improvement.ImprovementSource.Quality, "A", Improvement.ImprovementType.Reach, "", 1);
        manager.CreateImprovement("", Improvement.ImprovementSource.Quality, "B", Improvement.ImprovementType.Reach, "u", 2);
        manager.CreateImprovement("", Improvement.ImprovementSource.Quality, "C", Improvement.ImprovementType.Reach, "u", 3);
        manager.CreateImprovement("", Improvement.ImprovementSource.Quality, "D", Improvement.ImprovementType.Reach, "", 5);
        manager.CreateImprovement("", Improvement.ImprovementSource.Quality, "E", Improvement.ImprovementType.Initiative, "", 7);
        manager.Commit();
        character.Improvements.Single(objImprovement => objImprovement.SourceName == "D").Enabled = false;

        Assert.Equal(4, manager.ValueOf(Improvement.ImprovementType.Reach));
    }

    [Theory]
    [InlineData("Rating + BOD", 7)]
    [InlineData("Rating div 2", 1)]
    public void A_value_with_the_rating_and_an_attribute_is_calculated_without_the_application(string strValue, int expected)
    {
        Assert.Equal(expected, SkillValueOf(strValue));
    }

    [Theory]
    [InlineData("ru-RU")]
    [InlineData("de-DE")]
    public void A_fractional_value_is_the_same_where_the_decimal_separator_is_a_comma(string strCulture)
    {
        CultureInfo previous = CultureInfo.CurrentCulture;
        CultureInfo.CurrentCulture = new CultureInfo(strCulture);
        try
        {
            Assert.Equal(1, SkillValueOf("Rating div 2"));
        }
        finally
        {
            CultureInfo.CurrentCulture = previous;
        }
    }
    [Fact]
    public void A_manager_needs_dialogs()
    {
        Assert.Throws<ArgumentNullException>(() => new ImprovementManager(new TestCharacter(), null!));
    }

    // Creates the improvement of a forced skill whose value is the expression, for rating 3 and every attribute at 4, and returns its value.
    private static int SkillValueOf(string strValue)
    {
        TestCharacter character = new();
        foreach (string attribute in new[] { "BOD", "AGI", "REA", "STR", "CHA", "INT", "LOG", "WIL", "EDG", "MAG", "RES" })
            character.AttributeList[attribute] = new TestAttribute(4, 6);
        character.SkillList.Add(new TestSkill("Pistols", ""));
        ImprovementManager manager = new(character, new TestDialogs { Skill = "Pistols" });

        bool created = manager.CreateImprovements(Improvement.ImprovementSource.Power, "Improved Ability", Bonus("<selectskill><val>" + strValue + "</val></selectskill>"), intRating: 3);

        Assert.True(created);
        return Assert.Single(character.Improvements).Value;
    }
    private static XmlNode Bonus(string strChildren)
    {
        XmlDocument document = new();
        document.LoadXml("<bonus>" + strChildren + "</bonus>");
        return document.DocumentElement!;
    }
}
