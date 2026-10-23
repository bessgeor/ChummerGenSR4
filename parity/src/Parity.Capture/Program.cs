using Microsoft.Extensions.DependencyInjection;
using Parity.Capture.Cache;
using Parity.Capture.Coverage;
using Parity.Capture.Execution;
using Parity.Capture.Interop;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Capture.Timing;
using Parity.Capture.Ui;
using Parity.Cases;

namespace Parity.Capture;

/// <summary>Composition root of the capture runner.</summary>
internal static class Program
{
    public static int Main(string[] args)
    {
        DpiAwareness.Enable();
        using ServiceProvider services = BuildServices();
        return services.GetRequiredService<CaptureRun>().Execute(args);
    }

    internal static ServiceProvider BuildServices()
    {
        ServiceCollection services = new();
        services.AddSingleton(TimeProvider.System);

        services.AddSingleton<ActionExpander>();
        services.AddSingleton<CharacterModeReader>();
        services.AddSingleton<CaseFileLoader>();

        services.AddSingleton<FileHasher>();
        services.AddSingleton<CanonicalExecutableGuard>();
        services.AddSingleton<SettingsOverlayApplier>();
        services.AddSingleton<RunStager>();

        services.AddSingleton<WindowFinder>();
        services.AddSingleton<WindowActivator>();
        services.AddSingleton<WindowGeometry>();
        services.AddSingleton<TabNavigator>();
        services.AddSingleton<LabelWaiter>();
        services.AddSingleton<WindowCapturer>();
        services.AddSingleton<PointerParker>();
        services.AddSingleton<UiTreeReader>();
        services.AddSingleton<IWindowGraph, Win32WindowGraph>();
        services.AddSingleton<ActiveWindowResolver>();
        services.AddSingleton<ControlFinder>();
        services.AddSingleton<KeyboardInput>();
        services.AddSingleton<IControlAccess, UiaControlAccess>();
        services.AddSingleton<ControlActions>();
        services.AddSingleton(SaveTimeouts.Default);
        services.AddSingleton<ISaveCommand, CtrlSSaveCommand>();
        services.AddSingleton<CharacterSaver>();
        services.AddSingleton<SaveReloader>();
        services.AddTransient<DialogSafeCaller>();
        services.AddSingleton<Func<DialogSafeCaller>>(provider => provider.GetRequiredService<DialogSafeCaller>);
        services.AddSingleton<MessageRoundTrip>();
        services.AddSingleton<ChummerUiDriver>();
        services.AddSingleton<TimingRecorder>();
        services.AddSingleton<IUiDriver>(provider => new TimedUiDriver(
            provider.GetRequiredService<ChummerUiDriver>(),
            provider.GetRequiredService<TimingRecorder>(),
            provider.GetRequiredService<TimeProvider>()));

        services.AddSingleton<FolderFingerprinter>();
        services.AddSingleton<CacheEnvironmentReader>();
        services.AddSingleton<CacheSessionFactory>();
        services.AddSingleton<CacheKeyBuilder>();
        services.AddSingleton<CanonicalCaptureCache>();

        services.AddSingleton<SideExecutor>();
        services.AddSingleton<PixelComparer>();
        services.AddSingleton<VisualResultBuilder>();
        services.AddSingleton<CaseRunner>();
        services.AddSingleton<ReportWriter>();
        services.AddSingleton<ScreenInventory>();
        services.AddSingleton<CoverageAuditor>();
        services.AddSingleton<CaptureOptionsParser>();
        services.AddSingleton<CaptureRun>();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
    }
}
