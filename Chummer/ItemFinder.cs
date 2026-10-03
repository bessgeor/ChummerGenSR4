using System;
using System.Collections.Generic;

namespace Chummer
{
	/// <summary>
	/// Searches lists of the character's items for an item by its identifier.
	/// </summary>
	public class ItemFinder
	{
		protected readonly Character _objCharacter;

		/// <summary>
		/// Search the items of a character.
		/// </summary>
		/// <param name="objCharacter">Character whose items are searched.</param>
		public ItemFinder(Character objCharacter)
		{
			_objCharacter = objCharacter;
		}

		/// <summary>
		/// Locate a piece of Gear.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstGear">List of Gear to search.</param>
		public Gear FindGear(string strGuid, List<Gear> lstGear)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Gear objGear in lstGear)
			{
				if (objGear.InternalId == strGuid)
					objReturn = objGear;
				else
				{
					if (objGear.Children.Count > 0)
						objReturn = FindGear(strGuid, objGear.Children);
				}

				if (objReturn != null)
				{
					if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						return objReturn;
				}
			}

			objReturn = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a piece of Gear by matching on its Weapon ID.
		/// </summary>
		/// <param name="strGuid">InternalId of the Weapon to find.</param>
		/// <param name="lstGear">List of Gear to search.</param>
		public Gear FindGearByWeaponID(string strGuid, List<Gear> lstGear)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Gear objGear in lstGear)
			{
				if (objGear.WeaponID == strGuid)
					objReturn = objGear;
				else
				{
					if (objGear.Children.Count > 0)
						objReturn = FindGearByWeaponID(strGuid, objGear.Children);
				}

				if (objReturn != null)
				{
					if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						return objReturn;
				}
			}

			objReturn = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a piece of Gear within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstVehicles">List of Vehicles to search.</param>
		/// <param name="objFoundVehicle">Vehicle that the Gear was found in.</param>
		public Gear FindVehicleGear(string strGuid, List<Vehicle> lstVehicles, out Vehicle objFoundVehicle)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Vehicle objVehicle in lstVehicles)
			{
				objReturn = FindGear(strGuid, objVehicle.Gear);

				if (objReturn != null)
				{
					if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
					{
						objFoundVehicle = objVehicle;
						return objReturn;
					}
				}

				// Look for any Gear that might be attached to this Vehicle through Weapon Accessories or Cyberware.
				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					// Weapon Accessories.
					WeaponAccessory objAccessory = new WeaponAccessory(_objCharacter);
					objReturn = FindWeaponGear(strGuid, objMod.Weapons, out objAccessory);

					if (objReturn != null)
					{
						if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						{
							objFoundVehicle = objVehicle;
							return objReturn;
						}
					}

					// Cyberware.
					Cyberware objCyberware = new Cyberware(_objCharacter);
					objReturn = FindCyberwareGear(strGuid, objMod.Cyberware, out objCyberware);

					if (objReturn != null)
					{
						if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						{
							objFoundVehicle = objVehicle;
							return objReturn;
						}
					}
				}
			}

			objFoundVehicle = null;
			objReturn = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a Vehicle within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Vehicle to Find.</param>
		/// <param name="lstArmors">List of Vehicles to search.</param>
		public Vehicle FindVehicle(string strGuid, List<Vehicle> lstVehicles)
		{
			foreach (Vehicle objVehicle in lstVehicles)
			{
				if (objVehicle.InternalId == strGuid)
					return objVehicle;
			}

			return null;
		}

		/// <summary>
		/// Locate a VehicleMod within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the VehicleMod to find.</param>
		/// <param name="lstArmors">List of Vehicles to search.</param>
		/// <param name="objFoundArmor">Vehicle that the VehicleMod was found in.</param>
		public VehicleMod FindVehicleMod(string strGuid, List<Vehicle> lstVehicles, out Vehicle objFoundVehicle)
		{
			foreach (Vehicle objVehicle in lstVehicles)
			{
				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					if (objMod.InternalId == strGuid)
					{
						objFoundVehicle = objVehicle;
						return objMod;
					}
				}
			}

			objFoundVehicle = null;
			return null;
		}

		/// <summary>
		/// Locate a Weapon within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InteralId of the Weapon to find.</param>
		/// <param name="lstVehicles">List of Vehicles to search.</param>
		/// <param name="objFoundVehicle">Vehicle that the Weapon was found in.</param>
		public Weapon FindVehicleWeapon(string strGuid, List<Vehicle> lstVehicles, out Vehicle objFoundVehicle)
		{
			Weapon objReturn = new Weapon(_objCharacter);
			foreach (Vehicle objVehicle in lstVehicles)
			{
				objReturn = FindWeapon(strGuid, objVehicle.Weapons);
				if (objReturn != null)
				{
					objFoundVehicle = objVehicle;
					return objReturn;
				}

				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					objReturn = FindWeapon(strGuid, objMod.Weapons);
					if (objReturn != null)
					{
						objFoundVehicle = objVehicle;
						return objReturn;
					}
				}
			}

			objFoundVehicle = null;
			return null;
		}

		/// <summary>
		/// Locate a Weapon Accessory within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Weapon Accessory to find.</param>
		/// <param name="lstVehicles">List of Vehicles to search.</param>
		public WeaponAccessory FindVehicleWeaponAccessory(string strGuid, List<Vehicle> lstVehicles)
		{
			WeaponAccessory objReturn = new WeaponAccessory(_objCharacter);
			foreach (Vehicle objVehicle in lstVehicles)
			{
				objReturn = FindWeaponAccessory(strGuid, objVehicle.Weapons);
				if (objReturn != null)
					return objReturn;

				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					objReturn = FindWeaponAccessory(strGuid, objMod.Weapons);
					if (objReturn != null)
						return objReturn;
				}
			}

			return null;
		}

		/// <summary>
		/// Locate a Weapon Mod within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Weapon Accessory to find.</param>
		/// <param name="lstVehicles">List of Vehicles to search.</param>
		public WeaponMod FindVehicleWeaponMod(string strGuid, List<Vehicle> lstVehicles)
		{
			WeaponMod objReturn = new WeaponMod(_objCharacter);
			foreach (Vehicle objVehicle in lstVehicles)
			{
				objReturn = FindWeaponMod(strGuid, objVehicle.Weapons);
				if (objReturn != null)
					return objReturn;

				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					objReturn = FindWeaponMod(strGuid, objMod.Weapons);
					if (objReturn != null)
						return objReturn;
				}
			}

			return null;
		}

		/// <summary>
		/// Locate a piece of Cyberware within the character's Vehicles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Cyberware to find.</param>
		/// <param name="lstVehicles">List of Vehicles to search.</param>
		public Cyberware FindVehicleCyberware(string strGuid, List<Vehicle> lstVehicles)
		{
			Cyberware objReturn = new Cyberware(_objCharacter);
			foreach (Vehicle objVehicle in lstVehicles)
			{
				foreach (VehicleMod objMod in objVehicle.Mods)
				{
					objReturn = FindCyberware(strGuid, objMod.Cyberware);
					if (objReturn != null)
						return objReturn;
				}
			}

			return null;
		}

		/// <summary>
		/// Locate a piece of Gear within the character's Armors.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstArmors">List of Armors to search.</param>
		/// <param name="objFoundArmor">Armor that the Gear was found in.</param>
		public Gear FindArmorGear(string strGuid, List<Armor> lstArmors, out Armor objFoundArmor)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Armor objArmor in lstArmors)
			{
				objReturn = FindGear(strGuid, objArmor.Gear);

				if (objReturn != null)
				{
					if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
					{
						objFoundArmor = objArmor;
						return objReturn;
					}
				}
			}

			objFoundArmor = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a piece of Armor within the character's Armors.
		/// </summary>
		/// <param name="strGuid">InternalId of the Armor to Find.</param>
		/// <param name="lstArmors">List of Armors to search.</param>
		public Armor FindArmor(string strGuid, List<Armor> lstArmors)
		{
			foreach (Armor objArmor in lstArmors)
			{
				if (objArmor.InternalId == strGuid)
					return objArmor;
			}

			return null;
		}

		/// <summary>
		/// Locate an Armor Mod within the character's Armors.
		/// </summary>
		/// <param name="strGuid">InternalId of the ArmorMod to Find.</param>
		/// <param name="lstArmors">List of Armors to search.</param>
		public ArmorMod FindArmorMod(string strGuid, List<Armor> lstArmors)
		{
			foreach (Armor objArmor in lstArmors)
			{
				foreach (ArmorMod objMod in objArmor.ArmorMods)
				{
					if (objMod.InternalId == strGuid)
						return objMod;
				}
			}

			return null;
		}

		/// <summary>
		/// Locate a piece of Gear within the character's Cyberware.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstCyberware">List of Cyberware to search.</param>
		/// <param name="objFoundCyberware">Cyberware that the Gear was found in.</param>
		public Gear FindCyberwareGear(string strGuid, List<Cyberware> lstCyberware, out Cyberware objFoundCyberware)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Cyberware objCyberware in lstCyberware)
			{
				objReturn = FindGear(strGuid, objCyberware.Gear);

				if (objReturn != null)
				{
					if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
					{
						objFoundCyberware = objCyberware;
						return objReturn;
					}
				}

				if (objCyberware.Children.Count > 0)
				{
					objReturn = FindCyberwareGear(strGuid, objCyberware.Children, out objFoundCyberware);
					if (objReturn != null)
					{
						if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						{
							objFoundCyberware = objCyberware;
							return objReturn;
						}
					}
				}
			}

			objFoundCyberware = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a Weapon within the character's Weapons.
		/// </summary>
		/// <param name="strGuid">InternalId of the Weapon to find.</param>
		/// <param name="lstWeaopns">List of Weapons to search.</param>
		public Weapon FindWeapon(string strGuid, List<Weapon> lstWeaopns)
		{
			Weapon objReturn = new Weapon(_objCharacter);
			foreach (Weapon objWeapon in lstWeaopns)
			{
				if (objWeapon.InternalId == strGuid)
					return objWeapon;

				// Look within Underbarrel Weapons.
				objReturn = FindWeapon(strGuid, objWeapon.UnderbarrelWeapons);
				if (objReturn != null)
					return objReturn;
			}

			return null;
		}

		/// <summary>
		/// Locate a WeaponAccessory within the character's Weapons.
		/// </summary>
		/// <param name="strGuid">InternalId of the WeaponAccessory to find.</param>
		/// <param name="lstWeapons">List of Weapons to search.</param>
		public WeaponAccessory FindWeaponAccessory(string strGuid, List<Weapon> lstWeapons)
		{
			WeaponAccessory objReturn = new WeaponAccessory(_objCharacter);
			foreach (Weapon objWeapon in lstWeapons)
			{
				foreach (WeaponAccessory objAccessory in objWeapon.WeaponAccessories)
				{
					if (objAccessory.InternalId == strGuid)
						return objAccessory;
				}

				// Look within Underbarrel Weapons.
				objReturn = FindWeaponAccessory(strGuid, objWeapon.UnderbarrelWeapons);
				if (objReturn != null)
					return objReturn;
			}

			return null;
		}

		/// <summary>
		/// Locate a WeaponMod within the character's Weapons.
		/// </summary>
		/// <param name="strGuid">InternalId of the WeaponMod to find.</param>
		/// <param name="lstWeapons">List of Weapons to search.</param>
		public WeaponMod FindWeaponMod(string strGuid, List<Weapon> lstWeapons)
		{
			WeaponMod objReturn = new WeaponMod(_objCharacter);
			foreach (Weapon objWeapon in lstWeapons)
			{
				foreach (WeaponMod objMod in objWeapon.WeaponMods)
				{
					if (objMod.InternalId == strGuid)
						return objMod;
				}

				// Look within Underbarrel Weapons.
				objReturn = FindWeaponMod(strGuid, objWeapon.UnderbarrelWeapons);
				if (objReturn != null)
					return objReturn;
			}

			return null;
		}

		/// <summary>
		/// Locate a piece of Gear within the character's Weapons.
		/// </summary>
		/// <param name="strGuid">InternalId of the Gear to find.</param>
		/// <param name="lstWeapons">List of Weapons to search.</param>
		/// <param name="objFoundAccessory">WeaponAccessory that the Gear was found in.</param>
		public Gear FindWeaponGear(string strGuid, List<Weapon> lstWeapons, out WeaponAccessory objFoundAccessory)
		{
			Gear objReturn = new Gear(_objCharacter);
			foreach (Weapon objWeapon in lstWeapons)
			{
				foreach (WeaponAccessory objAccessory in objWeapon.WeaponAccessories)
				{
					objReturn = FindGear(strGuid, objAccessory.Gear);

					if (objReturn != null)
					{
						if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
						{
							objFoundAccessory = objAccessory;
							return objReturn;
						}
					}
				}

				if (objWeapon.UnderbarrelWeapons.Count > 0)
				{
					objReturn = FindWeaponGear(strGuid, objWeapon.UnderbarrelWeapons, out objFoundAccessory);

					if (objReturn != null)
					{
						if (objReturn.InternalId != Guid.Empty.ToString() && objReturn.Name != "")
							return objReturn;
					}
				}
			}

			objFoundAccessory = null;
			return objReturn;
		}

		/// <summary>
		/// Locate a Lifestyle within the character's Lifestyles.
		/// </summary>
		/// <param name="strGuid">InternalId of the Lifestyle to find.</param>
		/// <param name="lstLifestyles">List of Lifestyles to search.</param>
		public Lifestyle FindLifestyle(string strGuid, List<Lifestyle> lstLifestyles)
		{
			foreach (Lifestyle objLifestyle in lstLifestyles)
			{
				if (objLifestyle.InternalId == strGuid)
					return objLifestyle;
			}

			return null;
		}

		/// <summary>
		/// Locate a piece of Cyberware within the character's Cyberware.
		/// </summary>
		/// <param name="strGuid">InternalId of the Cyberware to find.</param>
		/// <param name="lstCyberware">List of Cyberware to search.</param>
		public Cyberware FindCyberware(string strGuid, List<Cyberware> lstCyberware)
		{
			Cyberware objReturn = new Cyberware(_objCharacter);
			foreach (Cyberware objCyberware in lstCyberware)
			{
				if (objCyberware.InternalId == strGuid)
					return objCyberware;

				objReturn = FindCyberware(strGuid, objCyberware.Children);
				if (objReturn != null)
					return objReturn;
			}

			return null;
		}

		/// <summary>
		/// Locate a Complex Form within the character's Complex Forms.
		/// </summary>
		/// <param name="strGuid">InternalId of the Complex Form to find.</param>
		/// <param name="lstPrograms">List of Complex Forms to search.</param>
		public TechProgram FindTechProgram(string strGuid, List<TechProgram> lstPrograms)
		{
			foreach (TechProgram objProgram in lstPrograms)
			{
				if (objProgram.InternalId == strGuid)
					return objProgram;
			}

			return null;
		}

		/// <summary>
		/// Locate a Complex Form Option within the character's Complex Forms.
		/// </summary>
		/// <param name="strGuid">InternalId of the Complex Form Option to Find.</param>
		/// <param name="lstPrograms">List of Complex Forms to search.</param>
		/// <param name="objFoundProgram">Complex Form that the Option was found in.</param>
		public TechProgramOption FindTechProgramOption(string strGuid, List<TechProgram> lstPrograms, out TechProgram objFoundProgram)
		{
			foreach (TechProgram objProgram in lstPrograms)
			{
				foreach (TechProgramOption objOption in objProgram.Options)
				{
					if (objOption.InternalId == strGuid)
					{
						objFoundProgram = objProgram;
						return objOption;
					}
				}
			}

			objFoundProgram = null;
			return null;
		}

		/// <summary>
		/// Locate a Spell within the character's Spells.
		/// </summary>
		/// <param name="strGuid">InternalId of the Spell to find.</param>
		/// <param name="lstSpells">List of Spells to search.</param>
		public Spell FindSpell(string strGuid, List<Spell> lstSpells)
		{
			foreach (Spell objSpell in lstSpells)
			{
				if (objSpell.InternalId == strGuid)
					return objSpell;
			}

			return null;
		}

		/// <summary>
		/// Locate a Critter Power within the character's Critter Powers.
		/// </summary>
		/// <param name="strGuid">InternalId of the Critter Power to find.</param>
		/// <param name="lstCritterPowers">List of Critter Powers to search.</param>
		public CritterPower FindCritterPower(string strGuid, List<CritterPower> lstCritterPowers)
		{
			foreach (CritterPower objPower in lstCritterPowers)
			{
				if (objPower.InternalId == strGuid)
					return objPower;
			}

			return null;
		}

		/// <summary>
		/// Locate a Quality within the character's Qualities.
		/// </summary>
		/// <param name="strGuid">InternalId of the Quality to find.</param>
		/// <param name="lstQualities">List of Qualities to search.</param>
		public Quality FindQuality(string strGuid, List<Quality> lstQualities)
		{
			foreach (Quality objQuality in lstQualities)
			{
				if (objQuality.InternalId == strGuid)
					return objQuality;
			}

			return null;
		}

		/// <summary>
		/// Locate a Metamagic within the character's Metamagics.
		/// </summary>
		/// <param name="strGuid">InternalId of the Metamagic to find.</param>
		/// <param name="lstMetamagics">List of Metamagics to search.</param>
		public Metamagic FindMetamagic(string strGuid, List<Metamagic> lstMetamagics)
		{
			foreach (Metamagic objMetamagic in lstMetamagics)
			{
				if (objMetamagic.InternalId == strGuid)
					return objMetamagic;
			}

			return null;
		}

		/// <summary>
		/// Locate a Martial Art within the character's Martial Arts.
		/// </summary>
		/// <param name="strName">Name of the Martial Art to find.</param>
		/// <param name="lstMartialArts">List of Martial Arts to search.</param>
		public MartialArt FindMartialArt(string strName, List<MartialArt> lstMartialArts)
		{
			foreach (MartialArt objArt in lstMartialArts)
			{
				if (objArt.Name == strName)
					return objArt;
			}

			return null;
		}

		/// <summary>
		/// Locate a Martial Art Advantage within the character's Martial Arts.
		/// </summary>
		/// <param name="strGuid">InternalId of the Martial Art Advantage to find.</param>
		/// <param name="lstMartialArts">List of Martial Arts to search.</param>
		/// <param name="objFoundMartialArt">MartialArt the Advantage was found in.</param>
		public MartialArtAdvantage FindMartialArtAdvantage(string strGuid, List<MartialArt> lstMartialArts, out MartialArt objFoundMartialArt)
		{
			foreach (MartialArt objArt in lstMartialArts)
			{
				foreach (MartialArtAdvantage objAdvantage in objArt.Advantages)
				{
					if (objAdvantage.InternalId == strGuid)
					{
						objFoundMartialArt = objArt;
						return objAdvantage;
					}
				}
			}

			objFoundMartialArt = null;
			return null;
		}

		/// <summary>
		/// Locate a Martial Art Maneuver within the character's Martial Art Maneuvers.
		/// </summary>
		/// <param name="strGuid">InternalId of the Martial Art Maneuver to find.</param>
		/// <param name="lstManeuvers">List of Martial Art Maneuvers to search.</param>
		public MartialArtManeuver FindMartialArtManeuver(string strGuid, List<MartialArtManeuver> lstManeuvers)
		{
			foreach (MartialArtManeuver objManeuver in lstManeuvers)
			{
				if (objManeuver.InternalId == strGuid)
					return objManeuver;
			}

			return null;
		}
	}
}
