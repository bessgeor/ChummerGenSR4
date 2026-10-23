using Chummer;

namespace Parity.Tests;

public sealed class ApplicationHostTests
{
    // The host is process-wide state, so the whole life of it is one test, and nothing else in this assembly touches the host or the classes that read it.
    [Fact]
    public void The_library_refuses_to_run_without_a_host_and_takes_one_registration()
    {
        InvalidOperationException unregistered = Assert.Throws<InvalidOperationException>(() => ApplicationHost.Current);
        Assert.Contains("ApplicationHost.Current", unregistered.Message);

        TypeInitializationException failed = Assert.Throws<TypeInitializationException>(() => LanguageManager.Instance);
        InvalidOperationException inner = Assert.IsType<InvalidOperationException>(failed.InnerException);
        Assert.Contains("ApplicationHost.Current", inner.Message);

        Assert.Throws<ArgumentNullException>(() => ApplicationHost.Current = null!);

        RecordingHost host = new();
        ApplicationHost.Current = host;
        Assert.Same(host, ApplicationHost.Current);
        Assert.Empty(host.Calls);

        InvalidOperationException again = Assert.Throws<InvalidOperationException>(() => ApplicationHost.Current = new RecordingHost());
        Assert.Contains("already registered", again.Message);
        Assert.Same(host, ApplicationHost.Current);
    }

    private sealed class RecordingHost : IApplicationHost
    {
        public List<string> Calls { get; } = [];

        public string StartupPath
        {
            get
            {
                Calls.Add(nameof(StartupPath));
                return Path.Combine(Path.GetTempPath(), "no-such-application-folder");
            }
        }

        public string ProductVersion
        {
            get
            {
                Calls.Add(nameof(ProductVersion));
                return "0.0.0.1";
            }
        }

        public void ShowError(string strText, string strCaption) => Calls.Add(nameof(ShowError));

        public void ShowInformation(string strText, string strCaption) => Calls.Add(nameof(ShowInformation));

        public bool AskYesNo(string strText, string strCaption)
        {
            Calls.Add(nameof(AskYesNo));
            return false;
        }

        public void Exit() => Calls.Add(nameof(Exit));

        public void SaveImage(byte[] bytImage, string strFileName) => Calls.Add(nameof(SaveImage));

        public void TranslateControls(object objObject) => Calls.Add(nameof(TranslateControls));

        public IImprovementDialogs ImprovementDialogs
        {
            get
            {
                Calls.Add(nameof(ImprovementDialogs));
                throw new InvalidOperationException("This test asks for no selection.");
            }
        }

        public IEquipmentHost Equipment
        {
            get
            {
                Calls.Add(nameof(Equipment));
                throw new InvalidOperationException("This test creates no equipment.");
            }
        }
    }
}
