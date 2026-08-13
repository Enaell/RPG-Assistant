export class SttError extends Error {
  /** HTTP status code returned by the API, if available. */
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'SttError';
    this.statusCode = statusCode;
    // Restore prototype chain (required when extending Error in TypeScript)
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
