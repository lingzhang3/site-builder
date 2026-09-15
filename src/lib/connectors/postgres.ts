import { Pool, type PoolClient, type QueryResultBase } from "pg";

import { assertHostAllowed } from "@/lib/query/host-guard";
import { credentialFingerprint, getOrCreatePool } from "./pool-cache";
import { applyRowLimit, normalizeRows, type RawRow } from "./normalize";
import type {
  ConnectionCredentials,
  Connector,
  QueryColumn,
  QueryResult,
  TableSchema,
  TestConnectionResult,
} from "./types";

/**
 * Postgres type OIDs, grouped into the handful of shapes a widget cares about.
 * Taken from `pg_type`; anything unlisted falls through to "unknown" and is
 * rendered as text.
 */
const NUMBER_OIDS = new Set([20, 21, 23, 26, 700, 701, 790, 1700]);
const BOOLEAN_OIDS = new Set([16]);
const DATE_OIDS = new Set([1082, 1083, 1114, 1184, 1266]);
const STRING_OIDS = new Set([18, 19, 25, 1042, 1043, 2950]);

export function normalizeOid(oid: number): QueryColumn["type"] {
  if (NUMBER_OIDS.has(oid)) return "number";
  if (BOOLEAN_OIDS.has(oid)) return "boolean";
  if (DATE_OIDS.has(oid)) return "date";
  if (STRING_OIDS.has(oid)) return "string";
  return "unknown";
}

function poolFor(credentials: ConnectionCredentials): Pool {
  const key = credentialFingerprint("postgres", credentials);
  return getOrCreatePool(
    key,
    () =>
      new Pool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        // `rejectUnauthorized: false` accepts self-signed certificates, which
        // most managed providers still use for the public endpoint. It gives
        // encryption without authentication of the server.
        ssl: credentials.ssl ? { rejectUnauthorized: false } : false,
        // Small: a dashboard opens several queries at once, but we must not
        // monopolize the customer's connection limit.
        max: 3,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        application_name: "site-builder",
      }),
    (pool) => void (pool as Pool).end(),
  );
}

function columnsFromFields(fields: QueryResultBase["fields"]): QueryColumn[] {
  return fields.map((field) => ({
    name: field.name,
    type: normalizeOid(field.dataTypeID),
  }));
}

export const postgresConnector: Connector = {
  type: "postgres",

  async testConnection(credentials: ConnectionCredentials): Promise<TestConnectionResult> {
    try {
      await assertHostAllowed(credentials.host);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    let client: PoolClient | undefined;
    try {
      client = await poolFor(credentials).connect();
      const version = await client.query<{ version: string }>("SELECT version()");

      // Not a failure — a warning. Customers should hand us a role that cannot
      // write, so that a bug here can never damage their data.
      const privileges = await client.query<{
        is_super: boolean | null;
        can_create: boolean | null;
        can_write_tables: boolean | null;
      }>(`
        SELECT
          (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS is_super,
          has_database_privilege(current_user, current_database(), 'CREATE') AS can_create,
          EXISTS (
            SELECT 1 FROM information_schema.table_privileges
            WHERE grantee IN (current_user, 'PUBLIC')
              AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')
          ) AS can_write_tables
      `);

      const row = privileges.rows[0];
      return {
        ok: true,
        serverVersion: version.rows[0]?.version,
        canWrite: Boolean(row?.is_super || row?.can_create || row?.can_write_tables),
      };
    } catch (error) {
      return { ok: false, error: describeDriverError(error) };
    } finally {
      client?.release();
    }
  },

  async introspectSchema(credentials: ConnectionCredentials): Promise<TableSchema[]> {
    await assertHostAllowed(credentials.host);
    const client = await poolFor(credentials).connect();
    try {
      const { rows } = await client.query<{
        table_schema: string;
        table_name: string;
        column_name: string;
        data_type: string;
        is_nullable: string;
      }>(`
        SELECT c.table_schema, c.table_name, c.column_name, c.data_type, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t
          ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
          AND t.table_type IN ('BASE TABLE', 'VIEW')
        ORDER BY c.table_schema, c.table_name, c.ordinal_position
        LIMIT 5000
      `);
      return groupColumnsIntoTables(rows);
    } finally {
      client.release();
    }
  },

  async runQuery(credentials, sql, { timeoutMs, rowLimit }): Promise<QueryResult> {
    await assertHostAllowed(credentials.host);
    const startedAt = Date.now();
    const client = await poolFor(credentials).connect();

    try {
      // The guarantee that this cannot write. `guard.ts` rejects obvious
      // writes for a better error message, but THIS is the layer that holds:
      // Postgres itself refuses any write inside a read-only transaction.
      await client.query("BEGIN TRANSACTION READ ONLY");
      // SET LOCAL is scoped to the transaction, so a pooled connection does
      // not carry the timeout over to the next query.
      await client.query(`SET LOCAL statement_timeout = ${Number(timeoutMs)}`);

      const result = await client.query<RawRow>(sql);
      const columns = columnsFromFields(result.fields);
      const { rows, truncated } = applyRowLimit(result.rows, rowLimit);

      return {
        columns,
        rows: normalizeRows(rows, columns),
        truncated,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      // Always roll back: there is nothing to commit, and this releases any
      // snapshot the transaction was holding on the customer's database.
      await client.query("ROLLBACK").catch(() => undefined);
      client.release();
    }
  },
};

export function groupColumnsIntoTables(
  rows: {
    table_schema: string;
    table_name: string;
    column_name: string;
    data_type: string;
    is_nullable: string;
  }[],
): TableSchema[] {
  const tables = new Map<string, TableSchema>();
  for (const row of rows) {
    const key = `${row.table_schema}.${row.table_name}`;
    let table = tables.get(key);
    if (!table) {
      table = { schema: row.table_schema, name: row.table_name, columns: [] };
      tables.set(key, table);
    }
    table.columns.push({
      name: row.column_name,
      dataType: row.data_type,
      nullable: row.is_nullable === "YES",
    });
  }
  return [...tables.values()];
}

/**
 * Driver errors can carry the connection string, and a timeout should read as
 * a timeout rather than "query canceled". Keep messages useful but boring.
 */
export function describeDriverError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;

  if (code === "57014" || /statement timeout|canceling statement/i.test(message)) {
    return "The query took too long and was cancelled. Narrow the time range or add an index.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Could not resolve the database host.";
  }
  if (code === "ECONNREFUSED") {
    return "The database refused the connection. Check the host, port and firewall rules.";
  }
  if (code === "ETIMEDOUT") {
    return "Timed out connecting to the database. Check that it accepts connections from this network.";
  }
  if (code === "28P01" || code === "28000") {
    return "Authentication failed. Check the user and password.";
  }
  if (code === "3D000") {
    return "That database does not exist on the server.";
  }
  if (code === "25006" || /read-only transaction/i.test(message)) {
    return "The query tried to modify data. Datasets must be read-only.";
  }
  return message;
}
