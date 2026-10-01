namespace Parity.Capture.Ui;

/// <summary>The mouse pointer could not be parked or left its parking spot; the message starts with <c>pointer</c>.</summary>
internal sealed class PointerException(string message)
    : InvalidOperationException($"pointer: {message}");
