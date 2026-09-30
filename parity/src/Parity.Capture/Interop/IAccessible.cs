using System.Runtime.InteropServices;

namespace Parity.Capture.Interop;

/// <summary>The MSAA <c>IAccessible</c> COM interface, as exposed by WinForms tab controls.</summary>
[ComImport]
[Guid("618736E0-3C3D-11CF-810C-00AA00389B71")]
[InterfaceType(ComInterfaceType.InterfaceIsDual)]
internal interface IAccessible
{
    [DispId(-5000)]
    object AccParent
    {
        [return: MarshalAs(UnmanagedType.Interface)]
        get;
    }

    [DispId(-5001)]
    int AccChildCount { get; }

    [DispId(-5002)]
    object GetAccChild([In] object childId);

    [DispId(-5003)]
    string? GetAccName([In] object childId);

    [DispId(-5004)]
    string? GetAccValue([In] object childId);

    [DispId(-5005)]
    string? GetAccDescription([In] object childId);

    [DispId(-5006)]
    object GetAccRole([In] object childId);

    [DispId(-5007)]
    object GetAccState([In] object childId);

    [DispId(-5008)]
    string? GetAccHelp([In] object childId);

    [DispId(-5009)]
    int GetAccHelpTopic([Out] out string file, [In] object childId);

    [DispId(-5010)]
    string? GetAccKeyboardShortcut([In] object childId);

    [DispId(-5011)]
    object GetAccFocus();

    [DispId(-5012)]
    object GetAccSelection();

    [DispId(-5013)]
    string? GetAccDefaultAction([In] object childId);

    [DispId(-5014)]
    void AccSelect([In] int flagsSelect, [In] object childId);

    [DispId(-5015)]
    void AccLocation([Out] out int left, [Out] out int top, [Out] out int width, [Out] out int height, [In] object childId);

    [DispId(-5016)]
    object AccNavigate([In] int navDir, [In] object childId);

    [DispId(-5017)]
    object AccHitTest([In] int left, [In] int top);

    [DispId(-5018)]
    void AccDoDefaultAction([In] object childId);
}
