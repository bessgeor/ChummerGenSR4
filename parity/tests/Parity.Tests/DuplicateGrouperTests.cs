using Parity.Compare.Analysis;
using Parity.Compare.Grouping;
using Parity.Compare.Ocr;

namespace Parity.Tests;

public sealed class DuplicateGrouperTests
{
    private const string Hash = "aaaa";

    [Fact]
    public void Equal_pixels_at_a_slightly_shifted_place_are_duplicates()
    {
        // 30 px of 1280 is a 2.3 % offset: the position match is about 98.8 %.
        Assert.Single(new DuplicateGrouper().Group([At("a", 100, Hash), At("b", 130, Hash)]));
    }

    [Fact]
    public void Equal_pixels_far_apart_are_not_duplicates()
    {
        // 100 px of 1280 is a 7.8 % offset: the position match is about 96.1 %.
        Assert.Equal(2, new DuplicateGrouper().Group([At("a", 100, Hash), At("b", 200, Hash)]).Count);
    }

    [Fact]
    public void Different_pixels_at_the_same_place_are_not_duplicates()
    {
        Assert.Equal(2, new DuplicateGrouper().Group([At("a", 100, Hash), At("b", 100, "bbbb")]).Count);
    }

    [Fact]
    public void A_discrepancy_joins_the_first_matching_representative()
    {
        IReadOnlyList<IReadOnlyList<Finding>> groups = new DuplicateGrouper().Group(
            [At("a", 100, Hash), At("b", 100, "bbbb"), At("c", 110, Hash), At("d", 100, "bbbb")]);

        Assert.Equal([["a", "c"], ["b", "d"]], groups.Select(group => group.Select(item => item.Id).ToArray()).ToArray());
    }

    [Fact]
    public void Many_different_discrepancies_are_grouped_quickly()
    {
        Finding[] findings = Enumerable.Range(0, 50_000).Select(index => At($"f{index}", 100, $"hash{index}")).ToArray();

        Assert.Equal(findings.Length, new DuplicateGrouper().Group(findings).Count);
    }

    private static Finding At(string id, int x, string hash) => new(
        id,
        "build-test",
        id,
        new Size(1280, 680),
        new Rectangle(x, 300, 20, 10),
        new Rectangle(x - 12, 298, 44, 14),
        200,
        hash,
        $"{id}.canonical.png",
        $"{id}.candidate.png",
        OcrReadings.Empty(),
        OcrReadings.Empty());
}
