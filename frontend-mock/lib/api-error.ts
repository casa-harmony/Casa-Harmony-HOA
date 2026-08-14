/**
 * Shared error type for both transports.
 *
 * Lives in its own module so `lib/api.ts` (the dispatcher) and
 * `lib/mock-data/mock-api.ts` (the demo transport) can both use it without
 * importing each other.
 */
export class ApiError extends Error {
  status: number;
  /** Field-level messages when the API returns a validation failure. */
  details?: unknown;

  constructor(message: string, status: number, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }

  /** 401/403 — the session is gone or the role lacks the permission. */
  get isAuthError(): boolean {
    return this.status === 401 || this.status === 403;
  }
}
