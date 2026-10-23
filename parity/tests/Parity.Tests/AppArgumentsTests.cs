using System.Windows.Forms;
using Chummer;
using Parity.Tests.Fakes;

namespace Parity.Tests;

// The check with which the app's equipment host takes only the app's own character and tree node view.
public sealed class AppArgumentsTests
{
    [Fact]
    public void An_argument_of_the_apps_type_comes_back_as_it_is()
    {
        TreeNodeView view = new(new TreeNode("Armor"));

        TreeNodeView required = AppArguments.Require<TreeNodeView>(view, "objNode", "Needs the app's node");

        Assert.Same(view, required);
    }

    [Fact]
    public void An_argument_of_another_type_throws_naming_the_parameter_the_need_and_the_type()
    {
        ITreeNodeView foreign = new TestTreeNode();

        ArgumentException thrown = Assert.Throws<ArgumentException>(() => AppArguments.Require<TreeNodeView>(foreign, "objNode", "Needs the app's node"));

        Assert.Equal("objNode", thrown.ParamName);
        Assert.StartsWith("Needs the app's node, not " + typeof(TestTreeNode).FullName + ".", thrown.Message);
    }

    [Fact]
    public void A_missing_argument_throws_naming_the_parameter_and_null()
    {
        ArgumentException thrown = Assert.Throws<ArgumentException>(() => AppArguments.Require<TreeNodeView>(null!, "objNode", "Needs the app's node"));

        Assert.Equal("objNode", thrown.ParamName);
        Assert.StartsWith("Needs the app's node, not null.", thrown.Message);
    }

    [Fact]
    public void A_character_of_another_type_is_refused_where_the_apps_character_is_required()
    {
        ICharacter foreign = new TestItemCharacter();

        ArgumentException thrown = Assert.Throws<ArgumentException>(() => AppArguments.Require<TestCharacter>(foreign, "objCharacter", "Needs the app's character"));

        Assert.Equal("objCharacter", thrown.ParamName);
    }
}