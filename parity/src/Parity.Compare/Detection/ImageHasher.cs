using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using Parity.Imaging;

namespace Parity.Compare.Detection;

/// <summary>
/// The identity of a change: SHA-256 of the core's width and height followed by the canonical and the
/// candidate ARGB pixels inside the core, as lowercase hex.
/// </summary>
internal sealed class ImageHasher
{
    public string Hash(ArgbImage canonical, ArgbImage candidate, Rectangle core)
    {
        using IncrementalHash hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        Span<byte> size = stackalloc byte[8];
        BinaryPrimitives.WriteInt32LittleEndian(size, core.Width);
        BinaryPrimitives.WriteInt32LittleEndian(size[4..], core.Height);
        hash.AppendData(size);
        hash.AppendData(MemoryMarshal.AsBytes(canonical.Crop(core).Pixels));
        hash.AppendData(MemoryMarshal.AsBytes(candidate.Crop(core).Pixels));
        return Convert.ToHexStringLower(hash.GetHashAndReset());
    }
}
