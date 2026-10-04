namespace Parity.Capture.Ui;

/// <summary>The edit box of a text box, numeric up-down or combo box.</summary>
internal interface IValueBox
{
    string Value { get; }

    void Focus();

    void Set(string value);

    /// <summary>Leaves the control with Tab and waits until it has lost the keyboard focus, so a value it takes on leaving is taken.</summary>
    void LeaveWithTab();
}