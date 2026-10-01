/** A failed request: the status and the message the page shows. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
