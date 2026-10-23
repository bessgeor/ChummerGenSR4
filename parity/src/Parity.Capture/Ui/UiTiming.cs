namespace Parity.Capture.Ui;

/// <summary>Case-file timings: the extra startup wait and the settle interval.</summary>
internal sealed record UiTiming(TimeSpan StartupDelay, TimeSpan Settle);
