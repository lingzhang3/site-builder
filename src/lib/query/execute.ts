import "server-only";

import { and, eq, gte, sql as sqlExpr } from "drizzle-orm";

import { db } from "@/db";
import { connections, datasets, queryRuns, type Connection } from "@/db/schema";
import { DIALECTS, getConnector } from "@/lib/connectors";
import type { ConnectionCredentials, QueryResult } from "@/lib/connectors/types";
import { decryptJson } from "@/lib/crypto";
import { describeMysqlError } from "@/lib/connectors/mysql";
import { describeDriverError } from "@/lib/connectors/postgres";
import { SqlGuardError, assertReadOnlySelect, wrapWithRowLimit } from "./guard";
import { getPublicRateLimitPerMinute, getQueryLimits } from "./limits";

/**
 * The one path customer queries take. Everything else (the SQL editor preview,
 * a widget in the editor, a widget on a published page) calls in here, so the
 * read-only guard, the timeout, the row cap and the audit record cannot be
 * skipped by adding a new caller.
 */

export class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RateLimitError";
  }
}

export function decryptCredentials(connection: Connection): ConnectionCredentials {
  return decryptJson<ConnectionCredentials>(connection.encryptedConfig);
}

export interface RunQueryArgs {
  orgId: string;
  connection: Connection;
  sql: string;
  /** Set when running a saved dataset, for the audit trail. */
  datasetId?: string;
  /** Set when serving a published page, which also enables rate limiting. */
  publicationId?: string;
}

export interface RunQueryOutcome {
  ok: true;
  result: QueryResult;
}

export interface RunQueryFailure {
  ok: false;
  /** Safe to show the end user: never contains credentials. */
  error: string;
  kind: "invalid_sql" | "rate_limited" | "database_error";
}

export async function runQuery(args: RunQueryArgs): Promise<RunQueryOutcome | RunQueryFailure> {
  const { orgId, connection, sql, datasetId, publicationId } = args;
  const limits = getQueryLimits();
  const dialect = DIALECTS[connection.type];

  // 1. Reject obvious writes early, with a message that names the problem.
  try {
    assertReadOnlySelect(sql, dialect);
  } catch (error) {
    if (error instanceof SqlGuardError) {
      return { ok: false, kind: "invalid_sql", error: error.message };
    }
    throw error;
  }

  // 2. Public pages run queries on behalf of anonymous visitors, so they get a
  //    budget. Without this, a published URL is a free load generator pointed
  //    at the customer's production database.
  if (publicationId) {
    const allowed = await checkPublicationRateLimit(publicationId);
    if (!allowed) {
      return {
        ok: false,
        kind: "rate_limited",
        error: "This dashboard is being refreshed too often. Try again in a minute.",
      };
    }
  }

  const startedAt = Date.now();
  const credentials = decryptCredentials(connection);
  const connector = getConnector(connection.type);

  try {
    // 3. The engine enforces the row cap, so a huge table never reaches Node.
    const result = await connector.runQuery(credentials, wrapWithRowLimit(sql, limits.rowLimit), {
      timeoutMs: limits.timeoutMs,
      rowLimit: limits.rowLimit,
    });

    await recordRun({
      orgId,
      datasetId,
      publicationId,
      durationMs: result.durationMs,
      rowCount: result.rows.length,
      truncated: result.truncated,
      error: null,
    });

    return { ok: true, result };
  } catch (error) {
    const message =
      connection.type === "mysql" ? describeMysqlError(error) : describeDriverError(error);

    await recordRun({
      orgId,
      datasetId,
      publicationId,
      durationMs: Date.now() - startedAt,
      rowCount: 0,
      truncated: false,
      error: message.slice(0, 2000),
    });

    return { ok: false, kind: "database_error", error: message };
  }
}

/** Convenience wrapper for a saved dataset. */
export async function runDataset(
  orgId: string,
  datasetId: string,
  publicationId?: string,
): Promise<RunQueryOutcome | RunQueryFailure> {
  const row = await db
    .select({ dataset: datasets, connection: connections })
    .from(datasets)
    .innerJoin(connections, eq(connections.id, datasets.connectionId))
    .where(and(eq(datasets.id, datasetId), eq(datasets.orgId, orgId)))
    .limit(1);

  const found = row[0];
  if (!found) {
    return { ok: false, kind: "database_error", error: "That dataset no longer exists." };
  }

  return runQuery({
    orgId,
    connection: found.connection,
    sql: found.dataset.sql,
    datasetId: found.dataset.id,
    publicationId,
  });
}

async function recordRun(entry: {
  orgId: string;
  datasetId?: string;
  publicationId?: string;
  durationMs: number;
  rowCount: number;
  truncated: boolean;
  error: string | null;
}): Promise<void> {
  try {
    await db.insert(queryRuns).values({
      orgId: entry.orgId,
      datasetId: entry.datasetId ?? null,
      publicationId: entry.publicationId ?? null,
      durationMs: entry.durationMs,
      rowCount: entry.rowCount,
      truncated: entry.truncated,
      error: entry.error,
    });
  } catch {
    // The audit write must never be the reason a dashboard fails to render.
  }
}

/**
 * Fixed-window count over `query_runs`. Stored in the database rather than in
 * memory so the limit still holds with several app instances behind a load
 * balancer, which an in-process token bucket would not.
 */
async function checkPublicationRateLimit(publicationId: string): Promise<boolean> {
  const perMinute = getPublicRateLimitPerMinute();
  const windowStart = new Date(Date.now() - 60_000);

  const [row] = await db
    .select({ count: sqlExpr<number>`count(*)::int` })
    .from(queryRuns)
    .where(and(eq(queryRuns.publicationId, publicationId), gte(queryRuns.createdAt, windowStart)));

  return (row?.count ?? 0) < perMinute;
}
