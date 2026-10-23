using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>The character form's own Save command, Ctrl+S, sent with the focus on its status bar.</summary>
internal sealed class CtrlSSaveCommand(WindowCapturer capturer, KeyboardInput keyboard) : ISaveCommand
{
    public void Send(IntPtr mainWindow)
    {
        capturer.FocusStatusBar(mainWindow);
        keyboard.Press(NativeMethods.VkControl, NativeMethods.VkS);
    }
}