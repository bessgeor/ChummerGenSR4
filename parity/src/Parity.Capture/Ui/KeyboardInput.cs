using System.Runtime.InteropServices;
using Parity.Capture.Interop;

namespace Parity.Capture.Ui;

/// <summary>Sends key presses to the foreground window with <c>SendInput</c>; the pointer never moves.</summary>
internal sealed class KeyboardInput
{
    private const uint KeyUp = 0x0002;

    /// <summary>Presses the keys in order and releases them in reverse order, as a chord such as Ctrl+S.</summary>
    public void Press(params ushort[] keys)
    {
        NativeMethods.Input[] inputs = new NativeMethods.Input[keys.Length * 2];
        for (int index = 0; index < keys.Length; index++)
        {
            inputs[index] = Key(keys[index], 0);
            inputs[inputs.Length - 1 - index] = Key(keys[index], KeyUp);
        }

        uint sent = NativeMethods.SendInput((uint)inputs.Length, inputs, Marshal.SizeOf<NativeMethods.Input>());
        if (sent != inputs.Length)
        {
            throw new InvalidOperationException(
                $"SendInput sent {sent} of {inputs.Length} key events (error {Marshal.GetLastWin32Error()}).");
        }
    }

    private static NativeMethods.Input Key(ushort virtualKey, uint flags) => new()
    {
        Type = NativeMethods.InputKeyboard,
        Keyboard = new NativeMethods.KeyboardInput { VirtualKey = virtualKey, Flags = flags },
    };
}
