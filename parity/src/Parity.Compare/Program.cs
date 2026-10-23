using Microsoft.Extensions.DependencyInjection;
using Parity.Compare.Analysis;
using Parity.Compare.Detection;
using Parity.Compare.Grouping;
using Parity.Compare.Ocr;
using Parity.Compare.Report;
using Parity.Compare.Run;

namespace Parity.Compare;

/// <summary>Composition root of the comparer.</summary>
internal static class Program
{
    public static int Main(string[] args)
    {
        using ServiceProvider services = BuildServices();
        return services.GetRequiredService<CompareRun>().Execute(args);
    }

    internal static ServiceProvider BuildServices()
    {
        ServiceCollection services = new();
        services.AddSingleton<RegionFinder>();
        services.AddSingleton<CropExpander>();
        services.AddSingleton<DiscrepancyLocator>();
        services.AddSingleton<ImageHasher>();

        services.AddSingleton<OcrImagePreparer>();
        services.AddSingleton<IOcrEngineFactory, OcrEngineFactory>();

        services.AddSingleton<RowAnalyzer>();
        services.AddSingleton<DuplicateGrouper>();
        services.AddSingleton<ReportBuilder>();
        services.AddSingleton(_ => new ReportPrinter(Console.Out));
        services.AddSingleton<CompareOptionsParser>();
        services.AddSingleton<CompareRun>();
        return services.BuildServiceProvider(new ServiceProviderOptions { ValidateOnBuild = true, ValidateScopes = true });
    }
}
