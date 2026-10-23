namespace Parity.Cases;

/// <summary>Captures the main window under this name.</summary>
public sealed record CaptureAction(string CaptureName) : ParityAction
{
    public override string Describe() => $"capture:{CaptureName}";
}
