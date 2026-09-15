/**
 * Keeps one driver pool per distinct set of credentials.
 *
 * Opening a fresh TCP connection and doing a TLS handshake for every widget on
 * a dashboard would be slow and would hammer the customer's connection limit.
 * Pools are keyed by a hash of the credentials, so rotating a password
 * naturally produces a new pool and the stale one is disposed.
 *
 * Pools are cached on `globalThis` because Next's dev server re-evaluates
 * modules on every edit, which would otherwise leak a pool per reload.
 */

import { createHash } from "node:crypto";

import type { ConnectionCredentials } from "./types";

/** Stable identity for a credential set. Never contains the password itself. */
export function credentialFingerprint(
  type: string,
  credentials: ConnectionCredentials,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        type,
        credentials.host,
        credentials.port,
        credentials.database,
        credentials.user,
        credentials.password,
        credentials.ssl,
      ]),
    )
    .digest("hex");
}

interface CacheEntry<T> {
  pool: T;
  lastUsedAt: number;
}

const globalForPools = globalThis as unknown as {
  __connectorPools?: Map<string, CacheEntry<unknown>>;
};

const pools: Map<string, CacheEntry<unknown>> = (globalForPools.__connectorPools ??= new Map());

/** Pools idle longer than this are closed, releasing the customer's slots. */
const IDLE_EVICTION_MS = 5 * 60 * 1000;
/** Hard ceiling so one busy tenant cannot exhaust the process's sockets. */
const MAX_POOLS = 50;

export function getOrCreatePool<T>(key: string, create: () => T, destroy: (pool: T) => void): T {
  evictIdle(destroy as (pool: unknown) => void);

  const existing = pools.get(key);
  if (existing) {
    existing.lastUsedAt = Date.now();
    return existing.pool as T;
  }

  if (pools.size >= MAX_POOLS) {
    // Drop the least recently used pool to make room.
    let oldestKey: string | null = null;
    let oldestAt = Number.POSITIVE_INFINITY;
    for (const [candidateKey, entry] of pools) {
      if (entry.lastUsedAt < oldestAt) {
        oldestAt = entry.lastUsedAt;
        oldestKey = candidateKey;
      }
    }
    if (oldestKey) closePool(oldestKey, destroy as (pool: unknown) => void);
  }

  const pool = create();
  pools.set(key, { pool, lastUsedAt: Date.now() });
  return pool;
}

function closePool(key: string, destroy: (pool: unknown) => void): void {
  const entry = pools.get(key);
  if (!entry) return;
  pools.delete(key);
  try {
    destroy(entry.pool);
  } catch {
    // A pool that fails to close is already unusable; dropping the reference is
    // the best we can do.
  }
}

function evictIdle(destroy: (pool: unknown) => void): void {
  const cutoff = Date.now() - IDLE_EVICTION_MS;
  for (const [key, entry] of pools) {
    if (entry.lastUsedAt < cutoff) closePool(key, destroy);
  }
}

/** Used when credentials change or a connection is deleted. */
export function disposePool(key: string, destroy: (pool: unknown) => void): void {
  closePool(key, destroy);
}
