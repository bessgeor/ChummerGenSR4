namespace Parity.Capture.Staging;

/// <summary>
/// Copies a declared overlay folder over a staged app folder, file by file at the same relative
/// paths. The overlay only ever lands inside the run folder.
/// </summary>
internal sealed class SettingsOverlayApplier(FileHasher hasher)
{
    public IReadOnlyList<OverlayFileRecord> Apply(string overlayDirectory, string appDirectory)
    {
        string overlayRoot = Path.GetFullPath(overlayDirectory);
        if (!Directory.Exists(overlayRoot))
        {
            throw new SetupException($"The settings overlay folder does not exist: {overlayRoot}");
        }

        string appRoot = Path.TrimEndingDirectorySeparator(Path.GetFullPath(appDirectory)) + Path.DirectorySeparatorChar;
        List<OverlayFileRecord> records = [];
        foreach (string source in Directory.EnumerateFiles(overlayRoot, "*", SearchOption.AllDirectories).Order(StringComparer.Ordinal))
        {
            string relative = Path.GetRelativePath(overlayRoot, source);
            string target = Path.GetFullPath(Path.Combine(appRoot, relative));
            if (!target.StartsWith(appRoot, StringComparison.OrdinalIgnoreCase))
            {
                throw new SetupException($"The overlay file '{relative}' would land outside the staged app folder.");
            }

            bool replaced = File.Exists(target);
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            File.Copy(source, target, overwrite: true);
            records.Add(new OverlayFileRecord(relative.Replace('\\', '/'), hasher.Sha256(target), replaced));
        }

        if (records.Count == 0)
        {
            throw new SetupException($"The settings overlay folder is empty: {overlayRoot}");
        }

        return records;
    }
}
