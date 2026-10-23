using Chummer;

namespace Parity.Tests.Fakes;

/// <summary>
/// A tree node in memory that records what an item does to it.
/// </summary>
internal sealed class TestTreeNode : ITreeNodeView
{
    public string Text { get; set; } = "";
    public object? Tag { get; set; }
    public bool Gray { get; private set; }
    public int Expansions { get; private set; }
    public List<TestTreeNode> Children { get; } = [];
    public List<TestTreeNode> Created { get; } = [];

    object ITreeNodeView.Tag
    {
        get => Tag!;
        set => Tag = value;
    }

    public void ShowAsGrayText() => Gray = true;

    public ITreeNodeView NewNode()
    {
        TestTreeNode node = new();
        Created.Add(node);
        return node;
    }

    public void Add(ITreeNodeView objChild) => Children.Add((TestTreeNode)objChild);

    public void Expand() => Expansions++;
}
