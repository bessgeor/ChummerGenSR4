using System.Runtime.CompilerServices;
using System.Xml;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Hosted.Tests;

/// <summary>
/// Registers, once for this test process, an application host whose folder holds small data files, so that items can be created.
/// Every choice the host would ask of a user fails the test instead.
/// </summary>
internal sealed class HostedApplication : IApplicationHost
{
    private static readonly string Folder = Path.Combine(Path.GetTempPath(), "chummer-hosted-tests-" + Guid.NewGuid().ToString("N"));

    public string StartupPath => Folder;
    public string ProductVersion => throw Unasked();
    public IEquipmentHost Equipment { get; } = new RecordingEquipmentHost();

    public IImprovementDialogs ImprovementDialogs => throw Unasked();

    public static RecordingEquipmentHost Host => (RecordingEquipmentHost)((HostedApplication)ApplicationHost.Current).Equipment;

    [ModuleInitializer]
    internal static void Register()
    {
        Directory.CreateDirectory(Path.Combine(Folder, "lang"));
        Directory.CreateDirectory(Path.Combine(Folder, "data"));
        File.WriteAllText(Path.Combine(Folder, "lang", "en-us.xml"), "<chummer><strings /></chummer>");
        File.WriteAllText(Path.Combine(Folder, "data", "books.xml"), "<chummer><books /></chummer>");
        File.WriteAllText(Path.Combine(Folder, "data", "weapons.xml"), TestData.Weapons);
        File.WriteAllText(Path.Combine(Folder, "data", "vehicles.xml"), TestData.Vehicles);
        File.WriteAllText(Path.Combine(Folder, "data", "gear.xml"), TestData.Gear);
        AppDomain.CurrentDomain.ProcessExit += (sender, args) => Directory.Delete(Folder, true);
        ApplicationHost.Current = new HostedApplication();
        if (GlobalOptions.Instance.Language != "en-us")
            throw new InvalidOperationException("These tests expect the language option of the current user to be en-us, not " + GlobalOptions.Instance.Language + ".");
    }

    public void ShowError(string strText, string strCaption) => throw Unasked();

    public void ShowInformation(string strText, string strCaption) => throw Unasked();

    public bool AskYesNo(string strText, string strCaption) => throw Unasked();

    public void Exit() => throw Unasked();

    public void SaveImage(byte[] bytImage, string strFileName) => throw Unasked();

    public void TranslateControls(object objObject)
    {
    }

    private static InvalidOperationException Unasked() => new("The test host is asked for nothing.");

    /// <summary>
    /// Creates a weapon with only a name for every weapon an item grants and keeps it by its identifier.
    /// </summary>
    internal sealed class RecordingEquipmentHost : IEquipmentHost
    {
        private readonly Dictionary<string, TestWeapon> _weapons = [];

        public TestWeapon CreatedWeapon(string internalId)
        {
            lock (_weapons)
                return _weapons[internalId];
        }

        public int SelectNumber(int intMinimum, int intMaximum, string strDescription) => throw Unasked();

        public string SelectWeaponCategory(string strDescription, string strOnlyCategory) => throw Unasked();

        public IEquipmentWeapon CreateWeapon(XmlNode objXmlWeapon, ICharacter objCharacter, ITreeNodeView objNode)
        {
            TestWeapon weapon = new(objXmlWeapon["name"]!.InnerText);
            lock (_weapons)
                _weapons.Add(weapon.InternalId, weapon);
            objNode.Text = weapon.DisplayName;
            objNode.Tag = weapon.InternalId;
            return weapon;
        }
    }
}
