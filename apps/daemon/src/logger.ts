// Structured logger (pino). One JSON line per log record.

import { pino } from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: { app: 'daemon' },
});
