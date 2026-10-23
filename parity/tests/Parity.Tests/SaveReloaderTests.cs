using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class SaveReloaderTests : IDisposable
{
    private static readonly TimeSpan Short = TimeSpan.FromMilliseconds(200);
    private static readonly IntPtr Main = 1;
    private static readonly IntPtr Dialog = 2;
    private readonly string _folder = Directory.CreateTempSubdirectory("parity-reload-").FullName;
    private readonly string _path;
    private readonly List<string> _order = [];
    private readonly CountingCommand _command;
    private readonly SaveReloader _reloader;

    public SaveReloaderTests()
    {
        _path = Path.Combine(_folder, "character.chum");
        File.WriteAllText(_path, "old");
        _command = new CountingCommand(_path, _order);
        _reloader = new SaveReloader(new CharacterSaver(_command, new SaveTimeouts(Short, Short, Short)), new SaveTimeouts(Short, Short, Short));
    }

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public void The_character_is_saved_and_the_app_closed()
    {
        FakeApp app = new(exits: true, _order);

        _reloader.SaveAndClose(Target(Main), app);

        Assert.Equal(1, _command.Sent);
        Assert.Equal(1, app.CloseRequests);
        Assert.Equal(["save", "handled", "close"], _order);
    }

    [Fact]
    public void An_open_dialog_fails_before_anything_is_saved_or_closed()
    {
        FakeApp app = new(exits: true);

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _reloader.SaveAndClose(Target(Dialog), app));

        Assert.Contains("The dialog 'Active window 2' is open", error.Message);
        Assert.Equal(0, _command.Sent);
        Assert.Equal(0, app.CloseRequests);
    }

    [Fact]
    public void An_app_that_does_not_exit_fails_and_names_its_active_window()
    {
        FakeApp app = new(exits: false);

        InvalidOperationException error = Assert.Throws<InvalidOperationException>(() => _reloader.SaveAndClose(Target(Main), app));

        Assert.Contains("did not exit within 0 s after saving", error.Message);
        Assert.Contains("Active window 1", error.Message);
        Assert.Equal(1, app.CloseRequests);
    }

    private SaveTarget Target(IntPtr active) =>
        new(Main, active, _path, () => _order.Add("handled"), () => $"Active window {active}");

    private sealed class FakeApp(bool exits, List<string>? order = null) : IClosableApp
    {
        public int CloseRequests { get; private set; }

        public void RequestClose()
        {
            CloseRequests++;
            order?.Add("close");
        }

        public bool WaitForExit(TimeSpan timeout) => exits;
    }

    private sealed class CountingCommand(string path, List<string> order) : ISaveCommand
    {
        public int Sent { get; private set; }

        public void Send(IntPtr mainWindow)
        {
            Sent++;
            order.Add("save");
            File.WriteAllText(path, "new");
        }
    }
}