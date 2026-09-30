using Parity.Capture.Execution;
using Parity.Cases;
using Parity.Contracts.CaptureResults;

namespace Parity.Capture.Run;

/// <summary>Both sides of one case and its visual result rows.</summary>
internal sealed record CaseRun(ParityCase Case, SideRun Canonical, SideRun Candidate, IReadOnlyList<CaptureResult> Results);
