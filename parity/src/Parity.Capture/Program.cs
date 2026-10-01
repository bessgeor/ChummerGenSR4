using Microsoft.Extensions.DependencyInjection;
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
        services.AddSingleton<ChummerUiDriver>();
        services.AddSingleton<TimingRecorder>();
        services.AddSingleton<IUiDriver>(provider => new TimedUiDriver(
            provider.GetRequiredService<ChummerUiDriver>(),
            provider.GetRequiredService<TimingRecorder>(),
            provider.GetRequiredService<TimeProvider>()));

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
