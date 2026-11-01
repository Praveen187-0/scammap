// Privacy rule 5: no personal data in logs. We log the method, the route PATTERN (never the URL, because a
// lookup URL contains the number being checked), the status and the duration. No bodies, no IPs.
export function logRequest(method: string, route: string, status: number, ms: number): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), m: method, r: route, s: status, ms: Math.round(ms * 10) / 10 })}\n`);
}

export function logInfo(msg: string, extra: Record<string, string | number | boolean> = {}): void {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), level: "info", msg, ...extra })}\n`);
}

export function logWarn(msg: string): void {
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: "warn", msg })}\n`);
}

/** Errors are logged by name and message only; stack traces can carry request data. */
export function logError(msg: string, err: unknown): void {
  const e = err instanceof Error ? `${err.name}: ${err.message}` : "unknown error";
  process.stderr.write(`${JSON.stringify({ t: new Date().toISOString(), level: "error", msg, error: e })}\n`);
}
