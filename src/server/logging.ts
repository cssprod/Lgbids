import type { FastifyServerOptions } from 'fastify';
import type { AppConfig } from './contracts.js';

/**
 * Fastify logger options for this config (OPS-10 adds the log file and
 * rotation). Stub from the v2 foundation: the same choice app.ts makes today.
 */
export function loggerOptions(_config: AppConfig): FastifyServerOptions['logger'] {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return false;
  return { level: process.env.LOG_LEVEL ?? 'info' };
}
