namespace Parity.Tests;

/// <summary>Locates the repository from the test output folder.</summary>
internal static class RepositoryPaths
{
    public static string Root { get; } = FindRoot();

    public static string Contracts => Path.Combine(Root, "contracts");

    public static string CaseFile => Path.Combine(Root, "parity", "cases", "characters.json");

    public static string Fixtures => Path.Combine(Root, "parity", "fixtures", "characters");

    private static string FindRoot()
    {
        for (DirectoryInfo? directory = new(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (Directory.Exists(Path.Combine(directory.FullName, "contracts", "schemas"))
                && Directory.Exists(Path.Combine(directory.FullName, "parity")))
            {
                return directory.FullName;
            }
        }

        throw new DirectoryNotFoundException($"No repository root above {AppContext.BaseDirectory}.");
    }
}
