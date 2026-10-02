using System;

namespace Chummer
{
	/// <summary>
	/// Holds the application host that the classes of this library use.
	/// </summary>
	public static class ApplicationHost
	{
		private static IApplicationHost _objCurrent;

		/// <summary>
		/// The registered application host. The application registers it once, before anything else touches this library;
		/// reading it earlier and registering a second host both throw.
		/// </summary>
		public static IApplicationHost Current
		{
			get
			{
				if (_objCurrent == null)
					throw new InvalidOperationException("No application host is registered: set ApplicationHost.Current when the application starts, before anything uses this library.");
				return _objCurrent;
			}
			set
			{
				if (value == null)
					throw new ArgumentNullException("value");
				if (_objCurrent != null)
					throw new InvalidOperationException("An application host is already registered: ApplicationHost.Current is set once.");
				_objCurrent = value;
			}
		}
	}
}
