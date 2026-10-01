/**
 * A failure that stops the workflow with the setup-error status (3): invalid options, a failed build, a tool
 * that ended with 3 or without trustworthy output, or anything else that means the run cannot go on.
 */
export class SetupError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SetupError";
  }
}
