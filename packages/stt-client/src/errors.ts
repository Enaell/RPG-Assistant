export class SttError extends Error {
  /** HTTP status code returned by the API, if available. */
  public readonly statusCode?: number;
  /** Delay (ms) the API asked us to wait before retrying, from the `Retry-After` header. */
  public readonly retryAfterMs?: number;

  constructor(message: string, statusCode?: number, retryAfterMs?: number) {
    super(message);
    this.name = 'SttError';
    this.statusCode = statusCode;
    this.retryAfterMs = retryAfterMs;
    // Restore prototype chain (required when extending Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
