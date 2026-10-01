using Parity.Contracts.CaptureSummary;

namespace Parity.Capture.Cache;

/// <summary>Opens the cache for a run once its canonical app is staged: creates the folder and reads the run-wide key inputs.</summary>
internal sealed class CacheSessionFactory(FolderFingerprinter fingerprinter, CacheEnvironmentReader environmentReader)
{
    public CacheSession Open(string directory, string stagedCanonicalApp, IReadOnlyList<ScreenInfo> screens)
    {
        Directory.CreateDirectory(directory);
        return new CacheSession(directory, fingerprinter.Fingerprint(stagedCanonicalApp), environmentReader.Read(screens));
    }
}
