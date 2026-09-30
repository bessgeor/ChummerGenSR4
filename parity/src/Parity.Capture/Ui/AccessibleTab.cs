using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>A tab item: the MSAA object of its tab control, its child id (1-based) and the control's HWND.</summary>
internal sealed record AccessibleTab(IAccessible Accessible, int ChildId, IntPtr ControlHandle);
