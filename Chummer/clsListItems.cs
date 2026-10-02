using System;
using System.Collections;
using System.Windows.Forms;

namespace Chummer
{
	/// <summary>
	/// ListItem class to make populating a DropDownList from a DataSource easier.
	/// </summary>
	public class ListItem
	{
		private string _strValue = "";
		private string _strName = "";

		/// <summary>
		/// Value.
		/// </summary>
		public string Value
		{
			get
			{
				return _strValue;
			}
			set
			{
				_strValue = value;
			}
		}

		/// <summary>
		/// Name.
		/// </summary>
		public string Name
		{
			get
			{
				return _strName;
			}
			set
			{
				_strName = value;
			}
		}
	}

	#region Sorting Classes
	/// <summary>
	/// Sort ListItems by Name in alphabetical order.
	/// </summary>
	public class SortListItem : IComparer
	{
		public int Compare(object objX, object objY)
		{
			ListItem lx = objX as ListItem;
			ListItem ly = objY as ListItem;

			return string.Compare(lx.Name, ly.Name);
		}
	}
	#endregion
}