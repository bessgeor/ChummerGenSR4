using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A weapon that an item grants, with only a name.
/// </summary>
internal sealed class TestWeapon(string name) : IEquipmentWeapon
{
    public string InternalId { get; } = Guid.NewGuid().ToString();
    public string Name { get; set; } = name;
    public string DisplayName => Name;
    public bool VehicleMounted { get; set; }
    public string Range { get; private set; } = "";

    public void SetRange(string strRange) => Range = strRange;
}