using System.Globalization;
using Parity.Capture.Staging;
using Parity.Capture.Ui;
using Parity.Cases;

namespace Parity.Capture.Cache;

/// <summary>
/// Builds a case's canonical cache key from the inputs that decide the canonical side's pixels and
/// outcomes: the staged canonical app, the fixture, the expanded actions in order, the capture filter,
/// the timings and the environment the runner reads (see <see cref="CacheEnvironmentReader"/>). What it
/// cannot read, such as fonts or other software that changes how a window is drawn, is not in the key.
/// </summary>
internal sealed class CacheKeyBuilder(FileHasher hasher)
{
    /// <summary>2: the pointer is parked on the title bar for every capture.</summary>
    public const int Format = 2;

    public CacheKey Build(
        CacheSession session,
        string canonicalSha256,
        ParityCase parityCase,
        IReadOnlySet<string>? captureFilter,
        UiTiming timing)
    {
        List<string> lines =
        [
            $"format:{Format}",
            $"canonical-exe:{canonicalSha256}",
            $"canonical-app:{session.AppFingerprint}",
            $"character:{hasher.Sha256(parityCase.CharacterPath)}",
            $"case:{parityCase.Name}",
            $"mode:{parityCase.Mode}",
        ];
        lines.AddRange(parityCase.Actions.Select((action, index) =>
            $"action:{index}:{(action.Required ? "required" : "optional")}:{action.Describe()}"));
        lines.Add($"capture-filter:{(captureFilter is null ? "*" : string.Join(",", captureFilter.Order(StringComparer.Ordinal)))}");
        lines.Add(string.Create(CultureInfo.InvariantCulture, $"timing:{timing.StartupDelay.TotalMilliseconds}:{timing.Settle.TotalMilliseconds}"));
        lines.AddRange(session.Environment.Lines);
        return CacheKey.Of(lines);
    }
}
