using Parity.Cases;
using Parity.Contracts.CompareReport;
using Parity.Contracts.ExecutionCoverage;
using CoverageOutcome = Parity.Contracts.ExecutionCoverage.Outcome;

namespace Parity.Compare.Accounting;

/// <summary>
/// Accounts for every capture the run's cases planned: each ends in the report, is explained by the
/// capture run's execution (filtered, optional tab absent, lost to a failure), or is unaccounted.
/// A report row that no case planned is unaccounted too.
/// </summary>
internal sealed class CompletenessBuilder
{
    public Parity.Contracts.CompareReport.Completeness Build(ExecutionCoverage coverage, IReadOnlyList<ReportRow> rows)
    {
        ILookup<(string Case, string Capture), ReportRow> rowsByCapture = rows.ToLookup(row => (row.Case, row.Capture));
        HashSet<(string Case, string Capture)> planned = [];
        List<CompletenessEntry> entries = [];
        foreach (CaseCoverage plannedCase in coverage.Cases)
        {
            foreach (string capture in plannedCase.PlannedCaptures)
            {
                planned.Add((plannedCase.Case, capture));
                entries.Add(Entry(plannedCase, capture, rowsByCapture[(plannedCase.Case, capture)].ToList()));
            }
        }

        entries.AddRange(rows
            .Where(row => !planned.Contains((row.Case, row.Capture)))
            .Select(row => new CompletenessEntry
            {
                Case = row.Case,
                Capture = row.Capture,
                State = CompletenessState.Unaccounted,
                Detail = "the report has a row for it, but no case of the run planned this capture",
            }));
        return new Parity.Contracts.CompareReport.Completeness
        {
            Complete = entries.All(entry => entry.State != CompletenessState.Unaccounted),
            Entries = entries,
            Totals = new CompletenessTotals
            {
                Planned = planned.Count,
                Reported = Count(entries, CompletenessState.Reported),
                AnalysisFailed = Count(entries, CompletenessState.AnalysisFailed),
                Filtered = Count(entries, CompletenessState.Filtered),
                OptionalAbsent = Count(entries, CompletenessState.OptionalAbsent),
                ExecutionLost = Count(entries, CompletenessState.ExecutionLost),
                Unaccounted = Count(entries, CompletenessState.Unaccounted),
            },
        };
    }

    private static CompletenessEntry Entry(CaseCoverage plannedCase, string capture, List<ReportRow> rows)
    {
        CompletenessEntry entry = new() { Case = plannedCase.Case, Capture = capture };
        if (rows.Count > 1)
        {
            entry.State = CompletenessState.Unaccounted;
            entry.Detail = $"the report has {rows.Count} rows for it";
            return entry;
        }

        if (rows.Count == 1)
        {
            entry.State = rows[0].Status == RowStatus.Failed ? CompletenessState.AnalysisFailed : CompletenessState.Reported;
            return entry;
        }

        List<(Contracts.ExecutionCoverage.Side Side, CoverageOutcome Outcome)> outcomes = plannedCase.Sides
            .Select(side => (side.Side, side.Captures.Where(item => item.Capture == capture).Select(item => item.Outcome).DefaultIfEmpty(CoverageOutcome.Missing).Single()))
            .ToList();
        string sides = string.Join(", ", outcomes.Select(item => $"{ContractJson.Name(item.Side)} {ContractJson.Name(item.Outcome)}"));
        if (outcomes.Count != 2)
        {
            entry.State = CompletenessState.Unaccounted;
            entry.Detail = $"the coverage has {outcomes.Count} sides for its case and the report has no row for it";
        }
        else if (outcomes.Any(item => item.Outcome is CoverageOutcome.Failed or CoverageOutcome.NotRun or CoverageOutcome.Missing))
        {
            entry.State = CompletenessState.ExecutionLost;
            entry.Detail = sides;
        }
        else if (outcomes.All(item => item.Outcome == CoverageOutcome.Filtered))
        {
            entry.State = CompletenessState.Filtered;
        }
        else if (outcomes.All(item => item.Outcome == CoverageOutcome.SkippedOptional))
        {
            entry.State = CompletenessState.OptionalAbsent;
        }
        else
        {
            entry.State = CompletenessState.Unaccounted;
            entry.Detail = $"{sides}, but the report has no row for it";
        }

        return entry;
    }

    private static long Count(List<CompletenessEntry> entries, CompletenessState state) => entries.Count(entry => entry.State == state);

}
