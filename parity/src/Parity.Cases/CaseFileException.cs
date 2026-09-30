namespace Parity.Cases;

/// <summary>A case file that cannot be loaded; the message names the file.</summary>
public sealed class CaseFileException : Exception
{
    public CaseFileException(string caseFilePath, string message)
        : base($"{caseFilePath}: {message}")
    {
        CaseFilePath = caseFilePath;
    }

    public CaseFileException(string caseFilePath, string message, Exception innerException)
        : base($"{caseFilePath}: {message}", innerException)
    {
        CaseFilePath = caseFilePath;
    }

    public string CaseFilePath { get; }
}
