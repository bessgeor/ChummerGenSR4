using System.Text;
using System.Xml;
using Chummer;

namespace Parity.Hosted.Tests;

public sealed class CharacterTests : IDisposable
{
    private readonly string _file = Path.Combine(HostedApplication.FolderPath, Guid.NewGuid().ToString("N") + ".chum");

    public CharacterTests()
    {
        HostedApplication.Current.Errors.Clear();
        HostedApplication.Current.SavedImages.Clear();
        HostedApplication.Current.Recording = true;
    }

    public void Dispose()
    {
        HostedApplication.Current.Recording = false;
        File.Delete(_file);
    }

    [Fact]
    public void A_saved_character_holds_the_hosts_product_version_and_loads_again()
    {
        Character character = new() { FileName = _file, Name = "Test Runner", Alias = "Tester" };

        character.Save();

        XmlDocument saved = new();
        saved.Load(_file);
        Assert.Equal("512", saved.SelectSingleNode("/character/appversion")!.InnerText);
        Character loaded = new() { FileName = _file };
        Assert.True(loaded.Load());
        Assert.Equal("Test Runner", loaded.Name);
        Assert.Equal("Tester", loaded.Alias);
        Assert.Empty(HostedApplication.Current.Errors);
    }

    [Fact]
    public void A_file_of_another_game_edition_shows_the_hosts_error_and_does_not_load()
    {
        File.WriteAllText(_file, "<character><gameedition>SR5</gameedition></character>");
        Character character = new() { FileName = _file };

        Assert.False(character.Load());

        Assert.Equal([("Test incorrect game version", "Test incorrect game version caption")], HostedApplication.Current.Errors);
    }

    [Fact]
    public void A_printed_mugshot_is_written_through_the_host_into_the_mugshots_folder()
    {
        byte[] image = [1, 2, 3, 4, 5];
        Character character = new() { FileName = _file, Name = "Test Runner", Metatype = "Human", Mugshot = Convert.ToBase64String(image) };

        XmlDocument printed = Print(character);

        (byte[] written, string fileName) = Assert.Single(HostedApplication.Current.SavedImages);
        Assert.Equal(image, written);
        Assert.Equal(Path.Combine(HostedApplication.FolderPath, "mugshots"), Path.GetDirectoryName(fileName));
        Assert.True(Directory.Exists(Path.Combine(HostedApplication.FolderPath, "mugshots")));
        Assert.Equal(".img", Path.GetExtension(fileName));
        Assert.Equal("file://" + fileName.Replace('\\', '/'), printed.SelectSingleNode("/characters/character/mugshot")!.InnerText);
        Assert.Equal(Convert.ToBase64String(image), printed.SelectSingleNode("/characters/character/mugshotbase64")!.InnerText);
    }

    [Fact]
    public void A_character_without_a_mugshot_prints_no_image()
    {
        Character character = new() { FileName = _file, Name = "Test Runner", Metatype = "Human" };

        XmlDocument printed = Print(character);

        Assert.Empty(HostedApplication.Current.SavedImages);
        Assert.Equal("", printed.SelectSingleNode("/characters/character/mugshot")!.InnerText);
    }
    [Fact]
    public void A_quality_of_an_old_save_file_is_converted_with_the_weapon_it_grants()
    {
        new Character() { FileName = _file, Name = "Test Runner", Metatype = "Human" }.Save();
        XmlDocument old = new();
        old.Load(_file);
        XmlNode qualities = old.SelectSingleNode("/character/qualities")!;
        qualities.InnerXml = "<quality>Test Claws Quality [5]</quality>";
        old.Save(_file);
        Character character = new() { FileName = _file };

        Assert.True(character.Load());

        Quality quality = Assert.Single(character.Qualities);
        Assert.Equal("Test Claws Quality", quality.Name);
        Weapon weapon = Assert.Single(character.Weapons);
        Assert.Equal("Test Claws", weapon.Name);
        Assert.Equal(weapon.InternalId, quality.WeaponID);
        Assert.Empty(HostedApplication.Current.Errors);
    }

    [Fact]
    public void The_item_searches_find_gear_plugged_into_other_gear_and_nothing_for_an_unknown_identifier()
    {
        Character character = new();
        Gear parent = new(character) { Name = "Test Commlink" };
        Gear child = new(character) { Name = "Test Sensor" };
        parent.Children.Add(child);
        List<Gear> gear = [parent];
        ItemFinder finder = new(character);

        Assert.Same(child, finder.FindGear(child.InternalId, gear));
        Assert.Same(parent, finder.FindGear(parent.InternalId, gear));
        Assert.Null(finder.FindGear(Guid.NewGuid().ToString(), gear));
    }

    private static XmlDocument Print(Character character)
    {
        using MemoryStream stream = new();
        using XmlTextWriter writer = new(stream, Encoding.UTF8);
        writer.WriteStartDocument();
        writer.WriteStartElement("characters");
        character.PrintToStream(stream, writer);
        writer.WriteEndElement();
        writer.WriteEndDocument();
        writer.Flush();
        XmlDocument printed = new();
        printed.LoadXml(Encoding.UTF8.GetString(stream.ToArray()).TrimStart('﻿'));
        return printed;
    }
}