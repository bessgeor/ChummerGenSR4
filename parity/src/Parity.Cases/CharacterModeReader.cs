using System.Xml;

namespace Parity.Cases;

/// <summary>Reads a character file's mode from its <c>&lt;created&gt;</c> element.</summary>
public sealed class CharacterModeReader
{
    public CharacterMode Read(string characterPath)
    {
        try
        {
            return ReadCreated(characterPath);
        }
        catch (XmlException error)
        {
            throw new InvalidDataException($"{characterPath}: not a readable character file: {error.Message}", error);
        }
    }

    private static CharacterMode ReadCreated(string characterPath)
    {
        using XmlReader reader = XmlReader.Create(characterPath, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit });
        reader.MoveToContent();
        if (reader.Name != "character")
        {
            throw new InvalidDataException($"{characterPath}: the root element is <{reader.Name}>, not <character>.");
        }

        while (reader.Read())
        {
            if (reader.NodeType == XmlNodeType.Element && reader.Depth == 1 && reader.Name == "created")
            {
                string value = reader.ReadElementContentAsString();
                return value switch
                {
                    "True" => CharacterMode.Career,
                    "False" => CharacterMode.Build,
                    _ => throw new InvalidDataException($"{characterPath}: <created> is '{value}', expected True or False."),
                };
            }
        }

        throw new InvalidDataException($"{characterPath}: the character has no <created> element.");
    }
}
