using System.Collections.Generic;

namespace Chummer
{
	/// <summary>
	/// What the improvement manager reads and changes on a character.
	/// </summary>
	public interface IImprovementCharacter
	{
		/// <summary>
		/// The character's improvements.
		/// </summary>
		List<Improvement> Improvements { get; }

		/// <summary>
		/// Whether or not the MAG Attribute is enabled.
		/// </summary>
		bool MAGEnabled { get; set; }

		/// <summary>
		/// Whether or not the RES Attribute is enabled.
		/// </summary>
		bool RESEnabled { get; set; }

		/// <summary>
		/// Whether or not the Magician tab is enabled.
		/// </summary>
		bool MagicianEnabled { get; set; }

		/// <summary>
		/// Whether or not the Adept tab is enabled.
		/// </summary>
		bool AdeptEnabled { get; set; }

		/// <summary>
		/// Whether or not the Technomancer tab is enabled.
		/// </summary>
		bool TechnomancerEnabled { get; set; }

		/// <summary>
		/// Whether or not the Critter tab is enabled.
		/// </summary>
		bool CritterEnabled { get; set; }

		/// <summary>
		/// Whether or not the Initiation tab is enabled.
		/// </summary>
		bool InitiationEnabled { get; set; }

		/// <summary>
		/// Whether or not the character has the Black Market discount.
		/// </summary>
		bool BlackMarket { get; set; }

		/// <summary>
		/// Whether or not the character is Uneducated.
		/// </summary>
		bool Uneducated { get; set; }

		/// <summary>
		/// Whether or not the character is Uncouth.
		/// </summary>
		bool Uncouth { get; set; }

		/// <summary>
		/// Whether or not the character is Infirm.
		/// </summary>
		bool Infirm { get; set; }

		/// <summary>
		/// Whether or not Adapsin is enabled.
		/// </summary>
		bool AdapsinEnabled { get; }

		/// <summary>
		/// The character's Initiate Grade.
		/// </summary>
		int InitiateGrade { get; set; }

		/// <summary>
		/// The character's Submersion Grade.
		/// </summary>
		int SubmersionGrade { get; set; }

		/// <summary>
		/// Get an Attribute by its name.
		/// </summary>
		/// <param name="strAttribute">Attribute name to retrieve.</param>
		IImprovementAttribute GetAttribute(string strAttribute);

		/// <summary>
		/// The character's Skills.
		/// </summary>
		IEnumerable<IImprovementSkill> Skills { get; }

		/// <summary>
		/// The character's Weapons.
		/// </summary>
		IEnumerable<IImprovementWeapon> Weapons { get; }

		/// <summary>
		/// Convert every Adapsin Cyberware Grade of the character's Cyberware to its non-Adapsin version.
		/// </summary>
		void ConvertAdapsinGrades();
	}

	/// <summary>
	/// What the improvement manager reads of an Attribute.
	/// </summary>
	public interface IImprovementAttribute
	{
		/// <summary>
		/// The Attribute's total value.
		/// </summary>
		int TotalValue { get; }

		/// <summary>
		/// The Attribute's Metatype maximum.
		/// </summary>
		int MetatypeMaximum { get; }
	}

	/// <summary>
	/// What the improvement manager reads of a Skill.
	/// </summary>
	public interface IImprovementSkill
	{
		/// <summary>
		/// The Skill's name.
		/// </summary>
		string Name { get; }

		/// <summary>
		/// The Skill's specialization.
		/// </summary>
		string Specialization { get; }
	}

	/// <summary>
	/// What the improvement manager reads of a Weapon.
	/// </summary>
	public interface IImprovementWeapon
	{
		/// <summary>
		/// The Weapon's name.
		/// </summary>
		string Name { get; }

		/// <summary>
		/// The Weapon's name as the user sees it.
		/// </summary>
		string DisplayName { get; }
	}
}
