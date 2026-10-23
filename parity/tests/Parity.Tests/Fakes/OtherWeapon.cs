using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A weapon of another type than the lists hold.
/// </summary>
internal sealed class OtherWeapon : IEquipmentWeapon
{
    public string InternalId => "other";
    public string Name { get; set; } = "Other";
    public string DisplayName => Name;
    public bool VehicleMounted { get; set; }

    public void SetRange(string strRange)
    {
    }
}