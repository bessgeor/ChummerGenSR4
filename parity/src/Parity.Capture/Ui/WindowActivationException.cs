namespace Parity.Capture.Ui;

/// <summary>The app's window could not be brought to the foreground; the message starts with <c>window-activation</c>.</summary>
internal sealed class WindowActivationException(string message)
    : InvalidOperationException($"window-activation: {message}");
