namespace Chummer
{
	/// <summary>
	/// What armor, cyberware and gear read and change of a Weapon they grant.
	/// </summary>
	public interface IEquipmentWeapon
	{
		/// <summary>
		/// Internal identifier of the Weapon.
		/// </summary>
		string InternalId { get; }

		/// <summary>
		/// The Weapon's name.
		/// </summary>
		string Name { get; set; }

		/// <summary>
		/// The Weapon's name as the user sees it.
		/// </summary>
		string DisplayName { get; }

		/// <summary>
		/// Permanently alter the Weapon's Range category.
		/// </summary>
		/// <param name="strRange">Name of the new Range category to use.</param>
		void SetRange(string strRange);
	}
}
