using Parity.Capture.Staging;
using Parity.Capture.Ui;
using Parity.Cases;
using Parity.Contracts.UiTree;

namespace Parity.Capture.Execution;

/// <summary>Reads the candidate side's UI tree of one case's capture and writes it to <c>ui-trees/&lt;case&gt;/&lt;capture&gt;.json</c>.</summary>
internal sealed class UiTreeRecorder(RunLayout layout, string caseName)
{
    /// <summary>The session's tree; one without even the main window fails the capture.</summary>
    public IReadOnlyList<UiNode> Read(string captureName, IAppSession session)
    {
        IReadOnlyList<UiNode> nodes = session.DescribeTree();
        return nodes.Count > 0
            ? nodes
            : throw new InvalidOperationException($"The UI tree after capture '{captureName}' has no node, not even the main window.");
    }

    public void Write(string captureName, IReadOnlyList<UiNode> nodes)
    {
        string path = layout.UiTreePath(caseName, captureName);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, ContractJson.Write(new UiTree
        {
            RunId = layout.RunId,
            Case = caseName,
            Capture = captureName,
            Side = Side.Candidate,
            Nodes = [.. nodes],
        }) + "\n");
    }
}
