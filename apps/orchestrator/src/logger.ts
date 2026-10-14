/**
 * Minimal structured logger — one JSON line per event. No external dependency;
 * swap for pino/winston later if richer transport/levels are needed.
 */
export function log(event: string, fields: Record<string, unknown> = {}): void {
  console.log(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

export function logError(event: string, fields: Record<string, unknown> = {}): void {
  console.error(JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}
