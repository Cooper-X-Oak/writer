// Health — daemon liveness DTO. Internal API surface → plain TS interface (no zod).
// Returned by GET /api/health.

export interface Health {
  /** 'ok' when the daemon is serving normally. */
  status: 'ok' | 'degraded';
  /** Daemon package version (semver), e.g. "0.0.0". */
  version: string;
  /** Process uptime in milliseconds. */
  uptimeMs: number;
}
