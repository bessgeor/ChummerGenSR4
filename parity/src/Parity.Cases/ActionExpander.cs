using Parity.Contracts.ParityCases;

namespace Parity.Cases;

/// <summary>
/// Expands <c>include</c> actions and maps contract actions to the domain model, enforcing the
/// per-type fields that the schema cannot express.
/// </summary>
public sealed class ActionExpander
{
    public IReadOnlyList<ParityAction> Expand(
        IReadOnlyList<CaseAction> actions,
        IReadOnlyDictionary<string, List<CaseAction>> sequences,
        string context)
    {
        List<ParityAction> expanded = [];
        Append(actions, sequences, context, [], expanded);
        return expanded;
    }

    private static void Append(
        IReadOnlyList<CaseAction> actions,
        IReadOnlyDictionary<string, List<CaseAction>> sequences,
        string context,
        List<string> includeStack,
        List<ParityAction> expanded)
    {
        for (int index = 0; index < actions.Count; index++)
        {
            CaseAction action = actions[index];
            string location = $"{context}[{index}]";
            if (action.Type != CaseActionType.Include)
            {
                expanded.Add(Map(action, location));
                continue;
            }

            Allow(action, location, name: true);
            string sequenceName = action.Name!;
            if (includeStack.Contains(sequenceName, StringComparer.Ordinal))
            {
                throw new InvalidDataException(
                    $"{location}: sequence '{sequenceName}' includes itself ({string.Join(" -> ", includeStack)} -> {sequenceName}).");
            }

            if (!sequences.TryGetValue(sequenceName, out List<CaseAction>? sequence))
            {
                throw new InvalidDataException($"{location}: unknown sequence '{sequenceName}'.");
            }

            includeStack.Add(sequenceName);
            Append(sequence, sequences, $"sequences.{sequenceName}", includeStack, expanded);
            includeStack.RemoveAt(includeStack.Count - 1);
        }
    }

    private static ParityAction Map(CaseAction action, string location)
    {
        switch (action.Type)
        {
            case CaseActionType.SelectTab:
                Allow(action, location, name: true, optional: true);
                return new SelectTabAction(action.Name!, action.Optional ?? false);
            case CaseActionType.WaitFor:
                Allow(action, location, label: true);
                return new WaitForAction(action.Label!);
            case CaseActionType.Wait:
                Allow(action, location, milliseconds: true);
                long milliseconds = action.Milliseconds!.Value;
                if (milliseconds is < 0 or > int.MaxValue)
                {
                    throw new InvalidDataException($"{location}: milliseconds {milliseconds} is outside 0..{int.MaxValue}.");
                }

                return new WaitAction((int)milliseconds);
            case CaseActionType.Capture:
                Allow(action, location, name: true);
                return new CaptureAction(action.Name!);
            default:
                throw new InvalidDataException($"{location}: action type {action.Type} cannot be mapped.");
        }
    }

    /// <summary>Requires exactly the listed fields; <c>optional</c> is allowed where listed, never required.</summary>
    private static void Allow(
        CaseAction action,
        string location,
        bool name = false,
        bool label = false,
        bool milliseconds = false,
        bool optional = false)
    {
        Check(location, action.Type, "name", name, action.Name is not null);
        Check(location, action.Type, "label", label, action.Label is not null);
        Check(location, action.Type, "milliseconds", milliseconds, action.Milliseconds is not null);
        if (!optional && action.Optional is not null)
        {
            throw new InvalidDataException($"{location}: '{Wire(action.Type)}' does not take 'optional'.");
        }
    }

    private static void Check(string location, CaseActionType type, string field, bool expected, bool present)
    {
        if (expected && !present)
        {
            throw new InvalidDataException($"{location}: '{Wire(type)}' requires '{field}'.");
        }

        if (!expected && present)
        {
            throw new InvalidDataException($"{location}: '{Wire(type)}' does not take '{field}'.");
        }
    }

    private static string Wire(CaseActionType type) => type switch
    {
        CaseActionType.SelectTab => "selectTab",
        CaseActionType.WaitFor => "waitFor",
        CaseActionType.Wait => "wait",
        CaseActionType.Capture => "capture",
        CaseActionType.Include => "include",
        _ => type.ToString(),
    };
}
