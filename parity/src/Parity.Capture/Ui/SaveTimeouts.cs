namespace Parity.Capture.Ui;

/// <summary>How long a save may take to write the file, how long the file may stay open afterwards, and how long the app may take to exit.</summary>
internal sealed record SaveTimeouts(TimeSpan Write, TimeSpan Close, TimeSpan Exit)
{
    public static SaveTimeouts Default { get; } = new(TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(10), TimeSpan.FromSeconds(30));
}