export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) => new HttpError(400, message, fields);
export const unauthorized = (message = "Sign in to continue.") => new HttpError(401, message);
export const forbidden = (message = "Not allowed.") => new HttpError(403, message);
export const notFound = (message = "Not found.") => new HttpError(404, message);
export const conflict = (message: string, fields?: Record<string, string>) => new HttpError(409, message, fields);
