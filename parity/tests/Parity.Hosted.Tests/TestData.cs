namespace Parity.Hosted.Tests;

/// <summary>
/// The data files of the host's folder: the few items the tests create, with the elements the items read.
/// </summary>
internal static class TestData
{
    public const string Weapons = """
        <chummer>
          <accessories>
            <accessory><name>Test Scope</name><mount>Top</mount><avail>2</avail><cost>100</cost><source>SR4</source><page>1</page></accessory>
          </accessories>
          <mods>
            <mod><name>Test Stock</name><slots>1</slots><avail>2</avail><cost>50</cost><source>SR4</source><page>2</page></mod>
          </mods>
          <weapons>
            <weapon>
              <name>Test Pistol</name><category>Pistols</category><type>Ranged</type><reach>0</reach><damage>5P</damage><ap>-1</ap>
              <mode>SA</mode><rc>0</rc><ammo>10(c)</ammo><avail>4R</avail><cost>300</cost><source>SR4</source><page>3</page>
            </weapon>
            <weapon>
              <name>Test Launcher</name><category>Launchers</category><type>Ranged</type><reach>0</reach><damage>10P</damage><ap>-2</ap>
              <mode>SS</mode><rc>0</rc><ammo>1(m)</ammo><avail>12F</avail><cost>1200</cost><source>SR4</source><page>4</page>
            </weapon>
            <weapon>
              <name>Test Rifle</name><category>Rifles</category><type>Ranged</type><reach>0</reach><damage>6P</damage><ap>-1</ap>
              <mode>SA</mode><rc>0</rc><ammo>30(c)</ammo><avail>8R</avail><cost>800</cost><source>SR4</source><page>5</page>
              <underbarrel>Test Launcher</underbarrel>
              <accessories><accessory>Test Scope</accessory></accessories>
              <mods><mod>Test Stock</mod></mods>
            </weapon>
            <weapon>
              <name>Test Grenade</name><category>Gear</category><type>Ranged</type><reach>0</reach><damage>10P</damage><ap>-1</ap>
              <mode>SS</mode><rc>0</rc><ammo>1</ammo><avail>6R</avail><cost>30</cost><source>SR4</source><page>6</page>
            </weapon>
          </weapons>
        </chummer>
        """;

    public const string Vehicles = """
        <chummer>
          <mods>
            <mod><name>Weapon Mount, Fixed</name><category>Weapons</category><slots>1</slots><avail>4R</avail><source>SR4</source><page>1</page></mod>
            <mod><name>Weapon Mount, Turret</name><category>Weapons</category><slots>2</slots><avail>6R</avail><source>SR4</source><page>2</page></mod>
            <mod><name>Spoiler</name><category>Body</category><slots>1</slots><avail>2</avail><source>SR4</source><page>3</page></mod>
          </mods>
        </chummer>
        """;

    public const string Gear = """
        <chummer>
          <gears>
            <gear><name>Test Sensor</name><category>Sensors</category><avail>2</avail><rating>0</rating><cost>10</cost><source>SR4</source><page>1</page></gear>
            <gear>
              <name>Test Grenades</name><category>Grenades</category><avail>6R</avail><rating>0</rating><cost>30</cost><source>SR4</source><page>2</page>
              <addweapon>Test Grenade</addweapon>
            </gear>
          </gears>
        </chummer>
        """;

    // A car with two weapon mounts and three weapons: the third finds no free mount.
    public const string Car = """
        <vehicle>
          <name>Test Car</name><category>Cars</category><handling>1</handling><accel>10/20</accel><speed>50</speed><pilot>1</pilot><body>4</body>
          <armor>2</armor><sensor>1</sensor><avail>4</avail><cost>1000</cost><source>SR4</source><page>7</page>
          <mods><name>Weapon Mount, Fixed</name><name>Spoiler</name><name>Weapon Mount, Turret</name></mods>
          <gears><gear qty="2">Test Sensor</gear><gear>Test Grenades</gear></gears>
          <weapons>
            <weapon>
              <name>Test Pistol</name>
              <accessories><accessory><name>Test Scope</name><mount>Top</mount></accessory></accessories>
              <mods><mod><name>Test Stock</name></mod></mods>
            </weapon>
            <weapon><name>Test Launcher</name></weapon>
            <weapon><name>Test Launcher</name></weapon>
          </weapons>
        </vehicle>
        """;
}
