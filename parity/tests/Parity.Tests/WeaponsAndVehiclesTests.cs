using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Tests;

// Only what runs without an application host: creating weapons and vehicles reads the language, the options and the data files.
public sealed class WeaponsAndVehiclesTests
{
    [Fact]
    public void A_weapon_finds_its_loaded_ammunition_among_the_character_gear()
    {
        TestItemCharacter character = new();
        Gear ammunition = Ammunition(character, "<ap>-1</ap>");
        character.GearById[ammunition.InternalId] = ammunition;
        Weapon weapon = new(character) { AP = "-2", AmmoLoaded = ammunition.InternalId };

        Assert.Equal("-3", weapon.TotalAP);
        Assert.Equal(["gear " + ammunition.InternalId], character.GearSearches);
    }

    [Fact]
    public void A_weapon_looks_for_its_ammunition_in_the_vehicles_when_the_character_has_none()
    {
        TestItemCharacter character = new();
        Gear ammunition = Ammunition(character, "<ap>-4</ap>");
        character.VehicleGearById[ammunition.InternalId] = ammunition;
        Weapon weapon = new(character) { AP = "-2", AmmoLoaded = ammunition.InternalId };

        Assert.Equal("-6", weapon.TotalAP);
        Assert.Equal(["gear " + ammunition.InternalId, "vehicle gear " + ammunition.InternalId], character.GearSearches);
    }

    [Fact]
    public void A_weapon_without_ammunition_anywhere_keeps_its_own_armor_penetration()
    {
        TestItemCharacter character = new();
        string missing = Guid.NewGuid().ToString();
        Weapon weapon = new(character) { AP = "+1", AmmoLoaded = missing };

        Assert.Equal("+1", weapon.TotalAP);
        Assert.Equal(["gear " + missing, "vehicle gear " + missing], character.GearSearches);
    }

    [Theory]
    [InlineData("Cars", false, 8)]
    [InlineData("Drones: Small", false, 12)]
    [InlineData("Drones: Small", true, 20)]
    public void A_vehicle_limits_its_armor_by_its_body_unless_the_character_ignores_the_rules(string category, bool ignoreRules, int maxArmor)
    {
        TestItemCharacter character = new() { IgnoreRulesValue = ignoreRules };
        Vehicle vehicle = new(character) { Category = category, Body = 4 };

        Assert.Equal(maxArmor, vehicle.MaxArmor);
    }

    private static Gear Ammunition(TestItemCharacter character, string bonus)
    {
        XmlDocument document = new();
        document.LoadXml("<weaponbonus>" + bonus + "</weaponbonus>");
        return new Gear(character) { Name = "Ammo: APDS", Category = "Ammunition", WeaponBonus = document.DocumentElement };
    }
}
