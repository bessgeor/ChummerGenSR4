using Parity.Capture.Execution;
using Parity.Capture.Run;
using Parity.Capture.Staging;
using Parity.Cases;
using Parity.Contracts.ExecutionCoverage;
using CharacterMode = Parity.Cases.CharacterMode;

namespace Parity.Capture.Coverage;

/// <summary>
/// Audits a run's execution against each case's plan: every planned action has exactly one outcome
/// per side, at its own index, and every performed capture left a file and every file a performed
/// capture. Optional absences and the actions skipped with them are listed, never counted as failures.
/// </summary>
internal sealed class CoverageAuditor
{
    public ExecutionCoverage Audit(string runId, IReadOnlyList<CaseRun> runs)
    {
        List<string> reasons = [];
        List<CaseCoverage> cases = runs.Select(run => AuditCase(run, reasons)).ToList();
        List<SideCoverage> sides = cases.SelectMany(item => item.Sides).ToList();
        return new ExecutionCoverage
        {
            RunId = runId,
            Valid = reasons.Count == 0,
            InvalidReasons = reasons,
            Cases = cases,
            Totals = new CoverageTotals
            {
                Cases = cases.Count,
                Sides = sides.Count,
                CachedSides = sides.Count(side => side.Source == Source.Cache),
                Actions = sides.Sum(side => side.RecordedActions),
                Failures = sides.Sum(side => side.Failures.Count),
                StartupFailures = sides.Count(side => side.StartupFailure is not null),
                OptionalAbsent = sides.Sum(side => side.OptionalAbsent.Count),
                SkippedOptional = sides.Sum(side => side.SkippedOptional.Count),
                Filtered = sides.Sum(side => side.Filtered),
                NotRun = sides.Sum(side => side.NotRun),
                PlannedCaptures = cases.Sum(item => item.PlannedCaptures.Count),
                CapturedPairs = cases.Sum(item => item.PlannedCaptures.Count(capture =>
                    item.Sides.Count == 2 && item.Sides.All(side => side.Captures.Single(entry => entry.Capture == capture).File))),
            },
        };
    }

    private static CaseCoverage AuditCase(CaseRun run, List<string> reasons)
    {
        ParityCase parityCase = run.Case;
        return new CaseCoverage
        {
            Case = parityCase.Name,
            CharacterFile = parityCase.CharacterFile,
            Mode = parityCase.Mode == CharacterMode.Career ? Mode.Career : Mode.Build,
            PlannedActions = parityCase.Actions.Count,
            PlannedCaptures = parityCase.Actions.OfType<CaptureAction>().Select(action => action.CaptureName).ToList(),
            Sides = [AuditSide(parityCase, run.Canonical, reasons), AuditSide(parityCase, run.Candidate, reasons)],
        };
    }

    private static SideCoverage AuditSide(ParityCase parityCase, SideRun side, List<string> reasons)
    {
        IReadOnlyList<ParityAction> plan = parityCase.Actions;
        IReadOnlyList<ActionRecord> records = side.Actions;
        bool contiguous = records.Count == plan.Count
                          && records.Select((record, position) => record.Index == position && record.Action == plan[position].Describe()).All(matches => matches);
        List<ActionReference> failures = Select(records, OutcomeKind.Failed, withReason: true);
        string? startupFailure = side.Failed && failures.Count == 0 ? side.Failure : null;

        List<CaptureCoverage> captures = [];
        for (int index = 0; index < plan.Count; index++)
        {
            if (plan[index] is CaptureAction capture)
            {
                ActionRecord[] matching = records.Where(record => record.Index == index).ToArray();
                captures.Add(new CaptureCoverage
                {
                    Capture = capture.CaptureName,
                    Outcome = matching.Length == 1 ? Outcome(matching[0].Outcome) : Parity.Contracts.ExecutionCoverage.Outcome.Missing,
                    File = side.Captures.TryGetValue(capture.CaptureName, out string? path) && File.Exists(path),
                });
            }
        }

        string scope = $"{parityCase.Name}/{side.Side}";
        if (!contiguous)
        {
            reasons.Add($"action-gap:{scope}");
        }

        if (failures.Count > 0 || startupFailure is not null)
        {
            reasons.Add($"failure:{scope}");
        }

        if (captures.Any(capture => capture.Outcome == Parity.Contracts.ExecutionCoverage.Outcome.Performed && !capture.File))
        {
            reasons.Add($"capture-without-file:{scope}");
        }

        HashSet<string> planned = captures.Select(capture => capture.Capture).ToHashSet(StringComparer.Ordinal);
        if (captures.Any(capture => capture.File && capture.Outcome != Parity.Contracts.ExecutionCoverage.Outcome.Performed)
            || side.Captures.Keys.Any(name => !planned.Contains(name)))
        {
            reasons.Add($"file-without-capture:{scope}");
        }

        return new SideCoverage
        {
            Side = side.Side == RunLayout.CanonicalSide ? Side.Canonical : Side.Candidate,
            Source = side.Origin.FromCache ? Source.Cache : Source.Live,
            RecordedActions = records.Count,
            Contiguous = contiguous,
            StartupFailure = startupFailure,
            Failures = failures,
            OptionalAbsent = Select(records, OutcomeKind.OptionalAbsent, withReason: true),
            SkippedOptional = Select(records, OutcomeKind.SkippedOptional, withReason: false),
            Filtered = records.Count(record => record.Outcome == OutcomeKind.Filtered),
            NotRun = records.Count(record => record.Outcome == OutcomeKind.NotRun),
            Captures = captures,
        };
    }

    private static List<ActionReference> Select(IReadOnlyList<ActionRecord> records, OutcomeKind outcome, bool withReason) =>
        records.Where(record => record.Outcome == outcome)
            .Select(record => new ActionReference { Index = record.Index, Action = record.Action, Reason = withReason ? record.Reason : null })
            .ToList();

    private static Outcome Outcome(OutcomeKind outcome) => outcome switch
    {
        OutcomeKind.Performed => Parity.Contracts.ExecutionCoverage.Outcome.Performed,
        OutcomeKind.Failed => Parity.Contracts.ExecutionCoverage.Outcome.Failed,
        OutcomeKind.OptionalAbsent => Parity.Contracts.ExecutionCoverage.Outcome.OptionalAbsent,
        OutcomeKind.SkippedOptional => Parity.Contracts.ExecutionCoverage.Outcome.SkippedOptional,
        OutcomeKind.Filtered => Parity.Contracts.ExecutionCoverage.Outcome.Filtered,
        OutcomeKind.NotRun => Parity.Contracts.ExecutionCoverage.Outcome.NotRun,
        _ => throw new ArgumentOutOfRangeException(nameof(outcome), outcome, null),
    };
}
