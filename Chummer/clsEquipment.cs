using System;
using System.Collections;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;
using System.Xml;
using System.Xml.XPath;

namespace Chummer
{
	public class Equipment
	{
		public List<Armor> Armors = new List<Armor>();
		public List<ArmorMod> ArmorMods = new List<ArmorMod>();
		public List<Cyberware> Cyberwares = new List<Cyberware>();
		public List<Gear> Gears = new List<Gear>();
		public List<Vehicle> Vehicles = new List<Vehicle>();
		public List<VehicleMod> VehicleMods = new List<VehicleMod>();
		public List<Weapon> Weapons = new List<Weapon>();
		public List<WeaponAccessory> WeaponAccessories = new List<WeaponAccessory>();
		public List<WeaponMod> WeaponMods = new List<WeaponMod>();
	}
}