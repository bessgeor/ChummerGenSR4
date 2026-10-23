using Parity.Capture.Ui;

namespace Parity.Tests;

public sealed class CharacterSaverTests : IDisposable
{
    private static readonly TimeSpan Short = TimeSpan.FromMilliseconds(300);
    private readonly string _folder = Directory.CreateTempSubdirectory("parity-saver-").FullName;
    private readonly string _path;

    public CharacterSaverTests()
    {
        _path = Path.Combine(_folder, "character.chum");
        File.WriteAllText(_path, "old");
    }

    public void Dispose() => Directory.Delete(_folder, recursive: true);

    [Fact]
    public void A_write_after_the_command_is_waited_for_and_the_app_awaited_once()
    {
        int handled = 0;
        CharacterSaver saver = new(new WritingCommand(_path), new SaveTimeouts(Short, Short, Short));

        saver.Save(1, _path, () => handled++);

        Assert.Equal(1, handled);
        Assert.Equal("new", File.ReadAllText(_path));
    }

    [Fact]
    public void No_write_within_the_time_fails_and_the_app_is_not_awaited()
    {
        int handled = 0;
        CharacterSaver saver = new(new SilentCommand(), new SaveTimeouts(Short, Short, Short));

        TimeoutException error = Assert.Throws<TimeoutException>(() => saver.Save(1, _path, () => handled++));

        Assert.Contains("did not write character.chum", error.Message);
        Assert.Equal(0, handled);
    }

    [Fact]
    public void A_file_that_stays_open_after_the_write_is_waited_for_until_it_is_closed()
    {
        using FileStream held = new(_path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        CharacterSaver saver = new(new WritingCommand(_path, held), new SaveTimeouts(Short, TimeSpan.FromSeconds(5), Short));
        ReleaseAfter(held, 400);

        saver.Save(1, _path, () => { });

        using FileStream reopened = new(_path, FileMode.Open, FileAccess.Read, FileShare.None);
    }

    [Fact]
    public void A_file_that_stays_open_past_the_close_time_fails()
    {
        using FileStream held = new(_path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        CharacterSaver saver = new(new WritingCommand(_path, held), new SaveTimeouts(Short, Short, Short));

        IOException failure = Assert.Throws<IOException>(() => saver.Save(1, _path, () => { }));

        Assert.Contains("was still held open", failure.Message);
        Assert.Contains(Path.GetFileName(_path), failure.Message);
    }

    [Fact]
    public void The_close_wait_has_a_time_of_its_own_after_a_slow_message_round_trip()
    {
        using FileStream held = new(_path, FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        CharacterSaver saver = new(new WritingCommand(_path, held), new SaveTimeouts(Short, TimeSpan.FromSeconds(5), Short));
        ReleaseAfter(held, 700);

        saver.Save(1, _path, () => Thread.Sleep(500));

        using FileStream reopened = new(_path, FileMode.Open, FileAccess.Read, FileShare.None);
    }

    private static void ReleaseAfter(FileStream held, int milliseconds) => Task.Run(
        async () =>
        {
            await Task.Delay(milliseconds, TestContext.Current.CancellationToken);
            held.Dispose();
        },
        TestContext.Current.CancellationToken);

    /// <summary>Writes the file the way the app does, keeping it open when the app is still writing it.</summary>
    private sealed class WritingCommand(string path, FileStream? held = null) : ISaveCommand
    {
        public void Send(IntPtr mainWindow)
        {
            if (held is null)
            {
                File.WriteAllText(path, "new");
            }
            else
            {
                held.SetLength(0);
                held.Write("new"u8);
                held.Flush();
                File.SetLastWriteTimeUtc(path, DateTime.UtcNow);
            }
        }
    }

    private sealed class SilentCommand : ISaveCommand
    {
        public void Send(IntPtr mainWindow)
        {
        }
    }
}