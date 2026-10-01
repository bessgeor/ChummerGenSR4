using System.Diagnostics;
using System.Drawing.Imaging;
using Parity.Capture.Ui;
using Parity.Cases;

namespace Parity.Capture.Execution;

/// <summary>
/// Runs every action of a case on one side and records exactly one outcome per action. A failure
/// stops the side; the actions after it are recorded as not run.
/// </summary>
internal sealed class SideExecutor(IUiDriver driver)
{
    public SideRun Run(
        string side,
        string executablePath,
        ParityCase parityCase,
        string characterPath,
        UiTiming timing,
        IReadOnlySet<string>? captureFilter,
        Func<string, string> capturePath)
    {
        Stopwatch timer = Stopwatch.StartNew();
        IReadOnlyList<ParityAction> actions = parityCase.Actions;
        List<ActionRecord> records = [];
        Dictionary<string, string> captures = new(StringComparer.Ordinal);
        string? failure = null;
        IAppSession session;
        try
        {
            session = driver.Launch(executablePath, characterPath, timing);
        }
        catch (Exception error)
        {
            failure = $"startup: {Describe(error)}";
            records.AddRange(actions.Select((action, index) => Record(index, action, OutcomeKind.NotRun, null)));
            return new SideRun(side, records, captures, failure, timer.Elapsed);
        }

        using (session)
        {
            string? absentTab = null;
            for (int index = 0; index < actions.Count; index++)
            {
                ParityAction action = actions[index];
                if (failure is not null)
                {
                    records.Add(Record(index, action, OutcomeKind.NotRun, null));
                    continue;
                }

                if (action is CaptureAction filtered && captureFilter is not null && !captureFilter.Contains(filtered.CaptureName))
                {
                    records.Add(Record(index, action, OutcomeKind.Filtered, "not selected by --capture"));
                    continue;
                }

                if (absentTab is not null && action is not SelectTabAction)
                {
                    records.Add(Record(index, action, OutcomeKind.SkippedOptional, $"optional tab '{absentTab}' is absent"));
                    continue;
                }

                absentTab = null;

                try
                {
                    session.Activate();
                    Perform(session, action, captures, capturePath);
                    records.Add(Record(index, action, OutcomeKind.Performed, null));
                }
                catch (TabNotFoundException error) when (action is SelectTabAction { Optional: true } optionalTab)
                {
                    absentTab = optionalTab.TabName;
                    records.Add(Record(index, action, OutcomeKind.OptionalAbsent, error.Message));
                }
                catch (Exception error)
                {
                    string reason = Describe(error);
                    failure = $"action {index} ({action.Describe()}): {reason}";
                    records.Add(Record(index, action, OutcomeKind.Failed, reason));
                }
            }
        }

        return new SideRun(side, records, captures, failure, timer.Elapsed);
    }

    private static void Perform(
        IAppSession session,
        ParityAction action,
        Dictionary<string, string> captures,
        Func<string, string> capturePath)
    {
        switch (action)
        {
            case SelectTabAction selectTab:
                session.SelectTab(selectTab.TabName);
                break;
            case WaitForAction waitFor:
                session.WaitForLabel(waitFor.Label);
                break;
            case WaitAction wait:
                session.Wait(wait.Milliseconds);
                break;
            case CaptureAction capture:
                string path = capturePath(capture.CaptureName);
                Directory.CreateDirectory(Path.GetDirectoryName(path)!);
                using (Bitmap bitmap = session.Capture())
                {
                    bitmap.Save(path, ImageFormat.Png);
                }

                captures.Add(capture.CaptureName, path);
                break;
            default:
                throw new InvalidOperationException($"Unsupported action {action.Describe()}.");
        }
    }

    private static ActionRecord Record(int index, ParityAction action, OutcomeKind outcome, string? reason) =>
        new(index, action.Describe(), action.Required, outcome, reason);

    private static string Describe(Exception error) =>
        error is WindowActivationException or PointerException ? error.Message : $"{error.GetType().Name}: {error.Message}";
}
