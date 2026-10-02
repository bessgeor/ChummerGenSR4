using System.Collections.Generic;

namespace Chummer
{
	/// <summary>
	/// What the character's attributes, qualities, skills, magic, resonance, martial arts, contacts and critter powers read of their character.
	/// </summary>
	public interface ICharacter : IImprovementCharacter
	{
		/// <summary>
		/// Character Options.
		/// </summary>
		CharacterOptions Options { get; }

		/// <summary>
		/// Name of the settings file the character uses.
		/// </summary>
		string SettingsFile { get; }

		/// <summary>
		/// Whether or not the character has been saved as Created and is no longer considered to be in create mode.
		/// </summary>
		bool Created { get; }

		/// <summary>
		/// Method being used to build the character.
		/// </summary>
		CharacterBuildMethod BuildMethod { get; }

		/// <summary>
		/// Whether or not the character is a Critter.
		/// </summary>
		bool IsCritter { get; }

		/// <summary>
		/// Character's Metatype Category.
		/// </summary>
		string MetatypeCategory { get; }

		/// <summary>
		/// Whether or not the character's MAG and RES are not reduced by Essence loss.
		/// </summary>
		bool OverrideSpecialAttributeEssenceLoss { get; }

		/// <summary>
		/// The Essence penalty to the character's MAG or RES.
		/// </summary>
		int EssencePenalty { get; }

		/// <summary>
		/// Magic (MAG) Attribute.
		/// </summary>
		Attribute MAG { get; }

		/// <summary>
		/// The portion of a Mystic Adept's MAG that is used for magician abilities.
		/// </summary>
		int MAGMagician { get; }

		/// <summary>
		/// The character's wound modifiers.
		/// </summary>
		int WoundModifiers { get; }

		/// <summary>
		/// Whether or not the character has access to Skillsofts.
		/// </summary>
		bool SkillsoftAccess { get; }

		/// <summary>
		/// Get an Attribute by its name.
		/// </summary>
		/// <param name="strAttribute">Attribute name to retrieve.</param>
		new Attribute GetAttribute(string strAttribute);

		/// <summary>
		/// The name of the object that created an Improvement.
		/// </summary>
		/// <param name="objImprovement">Improvement to check.</param>
		string GetObjectName(Improvement objImprovement);

		/// <summary>
		/// Skills.
		/// </summary>
		new List<Skill> Skills { get; }

		/// <summary>
		/// Skill Groups.
		/// </summary>
		List<SkillGroup> SkillGroups { get; }

		/// <summary>
		/// Qualities.
		/// </summary>
		List<Quality> Qualities { get; }

		/// <summary>
		/// Technomancer Complex Forms.
		/// </summary>
		List<TechProgram> TechPrograms { get; }

		/// <summary>
		/// The character's Cyberware and Bioware.
		/// </summary>
		IEnumerable<ICharacterCyberware> Cyberware { get; }

		/// <summary>
		/// The character's Gear.
		/// </summary>
		IEnumerable<ICharacterGear> Gear { get; }
	}

	/// <summary>
	/// What the character's attributes read of a piece of Cyberware.
	/// </summary>
	public interface ICharacterCyberware
	{
		/// <summary>
		/// The Cyberware's category.
		/// </summary>
		string Category { get; }

		/// <summary>
		/// The limb slot a Cyberlimb occupies.
		/// </summary>
		string LimbSlot { get; }

		/// <summary>
		/// A Cyberlimb's total Body.
		/// </summary>
		int TotalBody { get; }

		/// <summary>
		/// A Cyberlimb's total Strength.
		/// </summary>
		int TotalStrength { get; }

		/// <summary>
		/// A Cyberlimb's total Agility.
		/// </summary>
		int TotalAgility { get; }
	}

	/// <summary>
	/// What the character's skills read of a piece of Gear.
	/// </summary>
	public interface ICharacterGear
	{
		/// <summary>
		/// The Gear's name.
		/// </summary>
		string Name { get; }

		/// <summary>
		/// The Gear's category.
		/// </summary>
		string Category { get; }

		/// <summary>
		/// The value selected for the Gear, such as a Skillsoft's Skill.
		/// </summary>
		string Extra { get; }

		/// <summary>
		/// The Gear's Rating.
		/// </summary>
		int Rating { get; }

		/// <summary>
		/// Whether or not the Gear is equipped.
		/// </summary>
		bool Equipped { get; }

		/// <summary>
		/// The Gear plugged into this one.
		/// </summary>
		IEnumerable<ICharacterGear> Children { get; }
	}
}
