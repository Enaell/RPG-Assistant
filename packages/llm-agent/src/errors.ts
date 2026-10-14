export class AgentError extends Error {
  /** HTTP status code returned by the API, if available. */
  public readonly statusCode?: number;
  /** Underlying cause (network error, JSON.parse error, Zod error), if any. */
  public override readonly cause?: unknown;

  constructor(message: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'AgentError';
    this.statusCode = statusCode;
    this.cause = cause;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
