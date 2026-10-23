using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Hosted.Tests;

/// <summary>
/// The node functions that an item is given for the nodes of its included items, each recording the kind of node it made.
/// </summary>
internal sealed class NodeFactories
{
    public List<(string Kind, TestTreeNode Node)> Made { get; } = [];

    public Func<ITreeNodeView> For(string kind) => () =>
    {
        TestTreeNode node = new();
        Made.Add((kind, node));
        return node;
    };

    public IEnumerable<string> Kinds => Made.Select(made => made.Kind);

    public IEnumerable<TestTreeNode> Nodes(string kind) => Made.Where(made => made.Kind == kind).Select(made => made.Node);
}
