namespace Parity.Capture.Staging;

/// <summary>The run cannot start or its inputs changed; reported with the setup-error status (exit 3).</summary>
internal sealed class SetupException : Exception
{
    public SetupException(string message)
        : base(message)
    {
    }

    public SetupException(string message, Exception innerException)
        : base(message, innerException)
    {
    }
}
