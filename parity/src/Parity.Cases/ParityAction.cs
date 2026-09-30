namespace Parity.Cases;

/// <summary>One UI action of a case, after sequence includes are expanded.</summary>
public abstract record ParityAction
{
    /// <summary>False only for actions whose target may legitimately be absent.</summary>
    public virtual bool Required => true;

    /// <summary>Readable identity used in reports, for example <c>selectTab:Skills</c>.</summary>
    public abstract string Describe();
}
