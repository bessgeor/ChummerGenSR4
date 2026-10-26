import type { IncomingMessage } from "node:http";

/** A failed request: the status and the message the page shows. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/**
 * A request is accepted only when it names this server by its loopback address (a page that rebinds another name to it does not),
 * and, when the browser says where the request comes from, only from a page of this server.
 */
export function requireOwnOrigin(request: IncomingMessage): void {
  const port = request.socket.localPort;
  const own = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!own.includes(request.headers.host ?? "")) throw new HttpError(403, "The request does not address this server by its loopback address.");
  const origin = request.headers.origin;
  if (origin !== undefined && !own.some((host) => origin === `http://${host}`)) throw new HttpError(403, "The request comes from another page.");
}
