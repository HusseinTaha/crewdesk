export class HubError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (code: string, message: string) => new HubError(404, code, message);
export const conflict = (code: string, message: string) => new HubError(409, code, message);
export const forbidden = (code: string, message: string) => new HubError(403, code, message);
export const unprocessable = (code: string, message: string, details?: unknown) =>
  new HubError(422, code, message, details);
