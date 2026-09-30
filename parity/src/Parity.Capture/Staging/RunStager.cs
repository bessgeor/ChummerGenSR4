using Parity.Cases;

namespace Parity.Capture.Staging;

/// <summary>
/// Builds the run folder: each app gets its executable plus copies of the canonical data, language,
/// settings, sheet and export files, then the optional overlay; the fixtures are copied too. The
/// canonical executable is only read.
/// </summary>
internal sealed class RunStager(FileHasher hasher, CanonicalExecutableGuard guard, SettingsOverlayApplier overlayApplier)
{
    /// <summary>Folders and files the app reads from its own folder, copied from the canonical <c>bin/</c>.</summary>
    public static readonly IReadOnlyList<string> SupportFolders = ["data", "lang", "settings", "sheets", "export"];

    public static readonly IReadOnlyList<string> SupportFiles = ["manifestdata.xml", "manifestlang.xml"];

    public StagedRun Stage(
        RunLayout layout,
        string repositoryRoot,
        string canonicalExecutable,
        string candidateExecutable,
        string? overlayDirectory,
        IReadOnlyList<ParityCase> cases)
    {
        string canonicalSource = Path.GetDirectoryName(canonicalExecutable)!;
        if (!File.Exists(candidateExecutable))
        {
            throw new SetupException($"The candidate executable does not exist: {candidateExecutable} (run npm run build:candidate).");
        }

        if (overlayDirectory is not null)
        {
            EnsureUncommittable(repositoryRoot, overlayDirectory);
        }

        string canonicalStaged = Path.Combine(layout.CanonicalApp, Path.GetFileName(canonicalExecutable));
        Directory.CreateDirectory(layout.CanonicalApp);
        File.Copy(canonicalExecutable, canonicalStaged);
        CopySupport(canonicalSource, layout.CanonicalApp);

        Directory.CreateDirectory(layout.CandidateApp);
        foreach (string file in Directory.EnumerateFiles(Path.GetDirectoryName(candidateExecutable)!))
        {
            File.Copy(file, Path.Combine(layout.CandidateApp, Path.GetFileName(file)));
        }

        CopySupport(canonicalSource, layout.CandidateApp);
        string candidateStaged = Path.Combine(layout.CandidateApp, Path.GetFileName(candidateExecutable));

        IReadOnlyList<OverlayFileRecord>? overlay = null;
        if (overlayDirectory is not null)
        {
            overlay = overlayApplier.Apply(overlayDirectory, layout.CanonicalApp);
            IReadOnlyList<OverlayFileRecord> candidateOverlay = overlayApplier.Apply(overlayDirectory, layout.CandidateApp);
            if (!overlay.Select(file => (file.RelativePath, file.Sha256)).SequenceEqual(candidateOverlay.Select(file => (file.RelativePath, file.Sha256))))
            {
                throw new SetupException("The settings overlay changed while it was being applied.");
            }
        }

        // Hashed after the overlay, so the hashes describe the executables that actually run.
        string canonicalHash = guard.Verify(canonicalStaged, "staged canonical executable");
        string candidateHash = hasher.Sha256(candidateStaged);

        Directory.CreateDirectory(layout.Characters);
        Dictionary<string, string> copies = new(StringComparer.Ordinal);
        foreach (ParityCase parityCase in cases)
        {
            string copy = Path.Combine(layout.Characters, parityCase.CharacterFile);
            File.Copy(parityCase.CharacterPath, copy);
            copies.Add(parityCase.Name, copy);
        }

        return new StagedRun(canonicalStaged, canonicalHash, candidateStaged, candidateHash, overlay, copies);
    }

    /// <summary>An overlay must live outside the repository or under its ignored <c>out/</c> folder.</summary>
    private static void EnsureUncommittable(string repositoryRoot, string overlayDirectory)
    {
        string root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(repositoryRoot)) + Path.DirectorySeparatorChar;
        string overlay = Path.TrimEndingDirectorySeparator(Path.GetFullPath(overlayDirectory)) + Path.DirectorySeparatorChar;
        string output = root + "out" + Path.DirectorySeparatorChar;
        if (overlay.StartsWith(root, StringComparison.OrdinalIgnoreCase) && !overlay.StartsWith(output, StringComparison.OrdinalIgnoreCase))
        {
            throw new SetupException($"The settings overlay must be outside the repository or under out/: {overlayDirectory}");
        }
    }

    private static void CopySupport(string canonicalSource, string appDirectory)
    {
        foreach (string folder in SupportFolders)
        {
            string source = Path.Combine(canonicalSource, folder);
            if (!Directory.Exists(source))
            {
                throw new SetupException($"The canonical folder is missing: {source}");
            }

            CopyTree(source, Path.Combine(appDirectory, folder));
        }

        foreach (string file in SupportFiles)
        {
            string source = Path.Combine(canonicalSource, file);
            if (!File.Exists(source))
            {
                throw new SetupException($"The canonical file is missing: {source}");
            }

            File.Copy(source, Path.Combine(appDirectory, file), overwrite: true);
        }
    }

    private static void CopyTree(string source, string target)
    {
        Directory.CreateDirectory(target);
        foreach (string directory in Directory.EnumerateDirectories(source, "*", SearchOption.AllDirectories))
        {
            Directory.CreateDirectory(Path.Combine(target, Path.GetRelativePath(source, directory)));
        }

        foreach (string file in Directory.EnumerateFiles(source, "*", SearchOption.AllDirectories))
        {
            File.Copy(file, Path.Combine(target, Path.GetRelativePath(source, file)), overwrite: true);
        }
    }
}
