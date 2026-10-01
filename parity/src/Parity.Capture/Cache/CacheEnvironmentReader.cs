using System.Globalization;
using Parity.Capture.Interop;
using Parity.Capture.Staging;
using Parity.Contracts.CaptureSummary;

namespace Parity.Capture.Cache;

/// <summary>Reads the current <see cref="CacheEnvironment"/>.</summary>
internal sealed class CacheEnvironmentReader(FileHasher hasher)
{
    public CacheEnvironment Read(IReadOnlyList<ScreenInfo> screens)
    {
        List<string> lines = screens
            .Select(screen => $"screen:{screen.DeviceName}:{(screen.Primary ? "primary" : "secondary")}:{Rect(screen.Bounds)}:{Rect(screen.WorkingArea)}")
            .ToList();
        lines.Add($"dpi:{NativeMethods.GetDpiForSystem()}");
        lines.Add($"os:{Environment.OSVersion.VersionString}");
        lines.Add($"culture:{CultureInfo.CurrentCulture.Name}/{CultureInfo.CurrentUICulture.Name}");
        lines.AddRange(Directory.EnumerateFiles(AppContext.BaseDirectory, "Parity.*.dll")
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(file => $"runner:{Path.GetFileName(file)}:{hasher.Sha256(file)}"));
        return new CacheEnvironment(lines);
    }

    private static string Rect(ScreenRect rect) => $"{rect.X},{rect.Y},{rect.Width}x{rect.Height}";
}
