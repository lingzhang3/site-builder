/**
 * Query limits, read from the environment with safe fallbacks.
 *
 * Parsed defensively: a typo in `.env` must not turn into "no timeout" or
 * "unlimited rows", which are exactly the settings that take down a customer's
 * production database.
 */

export interface QueryLimits {
  timeoutMs: number;
  rowLimit: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 120_000;
const DEFAULT_ROW_LIMIT = 5_000;
const MAX_ROW_LIMIT = 100_000;

export function parsePositiveInt(
  raw: string | undefined,
  fallback: number,
  max: number,
): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function getQueryLimits(env: NodeJS.ProcessEnv = process.env): QueryLimits {
  return {
    timeoutMs: parsePositiveInt(env.QUERY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    rowLimit: parsePositiveInt(env.QUERY_ROW_LIMIT, DEFAULT_ROW_LIMIT, MAX_ROW_LIMIT),
  };
}

export function getPublicCacheTtlSeconds(env: NodeJS.ProcessEnv = process.env): number {
  // A published link with no cache lets anyone with the URL re-query the
  // customer's database on every page load, so the floor is 1 second.
  return parsePositiveInt(env.PUBLIC_CACHE_TTL_SECONDS, 60, 3600);
}

export function getPublicRateLimitPerMinute(env: NodeJS.ProcessEnv = process.env): number {
  return parsePositiveInt(env.PUBLIC_RATE_LIMIT_PER_MINUTE, 60, 10_000);
}
