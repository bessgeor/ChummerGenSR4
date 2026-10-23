using System;

namespace Chummer
{
	/// <summary>
	/// Checks that the application's adapters get the application's own types from the library's interfaces.
	/// </summary>
	public static class AppArguments
	{
		/// <summary>
		/// The argument as the application's own type. Throws an ArgumentException that names the parameter for null and for any other type.
		/// </summary>
		/// <typeparam name="TApp">The application's type that the argument must be.</typeparam>
		/// <param name="objArgument">Argument that the library passed through an interface.</param>
		/// <param name="strParameter">Name of the parameter.</param>
		/// <param name="strNeed">What the adapter needs, for the message.</param>
		public static TApp Require<TApp>(object objArgument, string strParameter, string strNeed) where TApp : class
		{
			if (!(objArgument is TApp))
				throw new ArgumentException(strNeed + ", not " + (objArgument == null ? "null" : objArgument.GetType().FullName) + ".", strParameter);
			return (TApp)objArgument;
		}
	}
}
