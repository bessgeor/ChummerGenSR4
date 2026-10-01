using System.Globalization;
using Microsoft.Win32;
using Parity.Capture.Interop;
using Parity.Capture.Staging;
using Parity.Contracts.CaptureSummary;

namespace Parity.Capture.Cache;

/// <summary>
/// Reads the current <see cref="CacheEnvironment"/>: the screens with their per-monitor scale, the
/// system scale, the OS build and patch level, the cultures, the Windows colour, theme, font smoothing,
/// window metric, text scale and high contrast settings, the app's own options in the registry, and the
/// runner's assemblies.
/// </summary>
internal sealed class CacheEnvironmentReader(FileHasher hasher)
{
    private const string AppOptionsKey = @"Software\Chummer";
    private const string DwmKey = @"Software\Microsoft\Windows\DWM";
    private const string PersonalizeKey = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
    private const string SystemColorsKey = @"Control Panel\Colors";
    private const string DesktopKey = @"Control Panel\Desktop";
    private const string WindowMetricsKey = @"Control Panel\Desktop\WindowMetrics";
    private const string TextScaleKey = @"Software\Microsoft\Accessibility";
    private const string HighContrastKey = @"Control Panel\Accessibility\HighContrast";
    private const string WindowsVersionKey = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion";

    private const uint MonitorDefaultToNearest = 2;
    private const int EffectiveDpi = 0;

    public CacheEnvironment Read(IReadOnlyList<ScreenInfo> screens)
    {
        List<string> lines = screens
            .Select(screen => $"screen:{screen.DeviceName}:{(screen.Primary ? "primary" : "secondary")}:{Rect(screen.Bounds)}:{Rect(screen.WorkingArea)}")
            .ToList();
        lines.AddRange(screens.Select(screen => $"monitor-dpi:{screen.DeviceName}:{MonitorDpi(screen.Bounds)}"));
        lines.Add($"dpi:{NativeMethods.GetDpiForSystem()}");
        lines.Add($"os:{Environment.OSVersion.VersionString}");
        lines.Add($"os-patch:{Value(Registry.LocalMachine, WindowsVersionKey, "CurrentBuildNumber")}.{Value(Registry.LocalMachine, WindowsVersionKey, "UBR")}");
        lines.Add($"culture:{CultureInfo.CurrentCulture.Name}/{CultureInfo.CurrentUICulture.Name}");
        lines.AddRange(Values(Registry.CurrentUser, DwmKey, "dwm", name => true));
        lines.AddRange(Values(Registry.CurrentUser, PersonalizeKey, "personalize", name => true));
        lines.AddRange(Values(Registry.CurrentUser, SystemColorsKey, "system-colour", name => true));
        lines.AddRange(Values(Registry.CurrentUser, DesktopKey, "desktop", name => name.StartsWith("FontSmoothing", StringComparison.Ordinal)));
        lines.AddRange(Values(Registry.CurrentUser, WindowMetricsKey, "window-metric", name => true));
        lines.AddRange(Values(Registry.CurrentUser, TextScaleKey, "text-scale", name => name == "TextScaleFactor"));
        lines.AddRange(Values(Registry.CurrentUser, HighContrastKey, "high-contrast", name => name == "Flags"));
        lines.AddRange(Values(Registry.CurrentUser, AppOptionsKey, "app-option", IsAppOption));
        lines.AddRange(Directory.EnumerateFiles(AppContext.BaseDirectory, "Parity.*.dll")
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(file => $"runner:{Path.GetFileName(file)}:{hasher.Sha256(file)}"));
        return new CacheEnvironment(lines);
    }

    /// <summary>
    /// The app's options decide what it draws (the language, the start-up window); the recently used
    /// files it rewrites on every run and the Omae account are not options and stay out of the key.
    /// </summary>
    internal static bool IsAppOption(string name) =>
        !name.StartsWith("mru", StringComparison.OrdinalIgnoreCase)
        && !name.StartsWith("stickymru", StringComparison.OrdinalIgnoreCase)
        && !name.StartsWith("omae", StringComparison.OrdinalIgnoreCase);

    private static string MonitorDpi(ScreenRect bounds)
    {
        NativeMethods.PointStruct center = new() { X = (int)(bounds.X + (bounds.Width / 2)), Y = (int)(bounds.Y + (bounds.Height / 2)) };
        IntPtr monitor = NativeMethods.MonitorFromPoint(center, MonitorDefaultToNearest);
        int result = NativeMethods.GetDpiForMonitor(monitor, EffectiveDpi, out uint dpiX, out uint dpiY);
        return result == 0 ? $"{dpiX}x{dpiY}" : $"unreadable-{result}";
    }

    private static IEnumerable<string> Values(RegistryKey root, string path, string prefix, Func<string, bool> include)
    {
        using RegistryKey? key = root.OpenSubKey(path);
        if (key is null)
        {
            return [$"{prefix}:absent"];
        }

        List<string> values = key.GetValueNames()
            .Where(include)
            .Order(StringComparer.OrdinalIgnoreCase)
            .Select(name => $"{prefix}:{name}={Format(key.GetValue(name))}")
            .ToList();
        return values.Count == 0 ? [$"{prefix}:absent"] : values;
    }

    private static string Value(RegistryKey root, string path, string name)
    {
        using RegistryKey? key = root.OpenSubKey(path);
        return Format(key?.GetValue(name));
    }

    private static string Format(object? value) => value switch
    {
        null => "absent",
        byte[] bytes => Convert.ToHexString(bytes),
        string[] strings => string.Join("|", strings),
        IFormattable formattable => formattable.ToString(null, CultureInfo.InvariantCulture),
        _ => value.ToString() ?? string.Empty,
    };

    private static string Rect(ScreenRect rect) => $"{rect.X},{rect.Y},{rect.Width}x{rect.Height}";
}
