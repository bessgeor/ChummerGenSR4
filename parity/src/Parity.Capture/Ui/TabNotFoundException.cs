namespace Parity.Capture.Ui;

/// <summary>No visible tab item has the requested name. For an optional tab this is an expected absence.</summary>
internal sealed class TabNotFoundException(string message) : InvalidOperationException(message);
