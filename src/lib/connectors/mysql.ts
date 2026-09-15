import mysql, { type Pool, type PoolConnection, type FieldPacket, type RowDataPacket } from "mysql2/promise";

import { assertHostAllowed } from "@/lib/query/host-guard";
import { credentialFingerprint, getOrCreatePool } from "./pool-cache";
import { applyRowLimit, normalizeRows, type RawRow } from "./normalize";
import { groupColumnsIntoTables } from "./postgres";
import type {
  ConnectionCredentials,
  Connector,
  QueryColumn,
  QueryResult,
  TableSchema,
  TestConnectionResult,
} from "./types";

/**
 * MySQL wire protocol column type codes, grouped the same way as the Postgres
 * OIDs. See mysql2's `types` enum / the MySQL `enum_field_types` list.
 */
const NUMBER_TYPES = new Set([
  0, // DECIMAL
  1, // TINY
  2, // SHORT
  3, // LONG
  4, // FLOAT
  5, // DOUBLE
  8, // LONGLONG
  9, // INT24
  13, // YEAR
  246, // NEWDECIMAL
]);
const DATE_TYPES = new Set([
  7, // TIMESTAMP
  10, // DATE
  11, // TIME
  12, // DATETIME
  14, // NEWDATE
  17, // TIMESTAMP2
  18, // DATETIME2
  19, // TIME2
]);
const STRING_TYPES = new Set([
  15, // VARCHAR
  245, // JSON
  249, // TINY_BLOB
  250, // MEDIUM_BLOB
  251, // LONG_BLOB
  252, // BLOB / TEXT
  253, // VAR_STRING
  254, // STRING
]);

export function normalizeMysqlType(code: number | undefined): QueryColumn["type"] {
  if (code === undefined) return "unknown";
  if (NUMBER_TYPES.has(code)) return "number";
  if (DATE_TYPES.has(code)) return "date";
  if (STRING_TYPES.has(code)) return "string";
  return "unknown";
}

function poolFor(credentials: ConnectionCredentials): Pool {
  const key = credentialFingerprint("mysql", credentials);
  return getOrCreatePool(
    key,
    () =>
      mysql.createPool({
        host: credentials.host,
        port: credentials.port,
        database: credentials.database,
        user: credentials.user,
        password: credentials.password,
        ssl: credentials.ssl ? { rejectUnauthorized: false } : undefined,
        connectionLimit: 3,
        connectTimeout: 10_000,
        idleTimeout: 30_000,
        // Critical: with this on, one statement string could carry several
        // statements and the read-only checks in guard.ts would be moot.
        multipleStatements: false,
        // Keep DECIMAL/BIGINT as strings rather than lossy doubles;
        // normalizeRows converts the ones that fit exactly.
        decimalNumbers: false,
        supportBigNumbers: true,
        bigNumberStrings: true,
        // Return dates as strings in the connection's timezone rather than as
        // Date objects built from an ambiguous local time.
        dateStrings: true,
      }),
    (pool) => void (pool as Pool).end(),
  );
}

export const mysqlConnector: Connector = {
  type: "mysql",

  async testConnection(credentials: ConnectionCredentials): Promise<TestConnectionResult> {
    try {
      await assertHostAllowed(credentials.host);
    } catch (error) {
      return { ok: false, error: (error as Error).message };
    }

    let connection: PoolConnection | undefined;
    try {
      connection = await poolFor(credentials).getConnection();
      const [versionRows] = await connection.query<RowDataPacket[]>("SELECT version() AS version");
      const [grantRows] = await connection.query<RowDataPacket[]>("SHOW GRANTS FOR CURRENT_USER()");

      // Each row is a single GRANT statement; look for anything that implies
      // write access. A warning only.
      const grants = grantRows
        .map((row) => Object.values(row)[0])
        .filter((value): value is string => typeof value === "string")
        .join("\n")
        .toUpperCase();
      const canWrite = /\b(ALL PRIVILEGES|INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|SUPER)\b/.test(grants);

      return {
        ok: true,
        serverVersion: String(versionRows[0]?.version ?? ""),
        canWrite,
      };
    } catch (error) {
      return { ok: false, error: describeMysqlError(error) };
    } finally {
      connection?.release();
    }
  },

  async introspectSchema(credentials: ConnectionCredentials): Promise<TableSchema[]> {
    await assertHostAllowed(credentials.host);
    const connection = await poolFor(credentials).getConnection();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        `SELECT table_schema, table_name, column_name, data_type, is_nullable
         FROM information_schema.columns
         WHERE table_schema = DATABASE()
         ORDER BY table_name, ordinal_position
         LIMIT 5000`,
      );
      return groupColumnsIntoTables(
        rows.map((row) => ({
          table_schema: String(row.table_schema ?? row.TABLE_SCHEMA ?? ""),
          table_name: String(row.table_name ?? row.TABLE_NAME ?? ""),
          column_name: String(row.column_name ?? row.COLUMN_NAME ?? ""),
          data_type: String(row.data_type ?? row.DATA_TYPE ?? ""),
          is_nullable: String(row.is_nullable ?? row.IS_NULLABLE ?? "NO"),
        })),
      );
    } finally {
      connection.release();
    }
  },

  async runQuery(credentials, sql, { timeoutMs, rowLimit }): Promise<QueryResult> {
    await assertHostAllowed(credentials.host);
    const startedAt = Date.now();
    const connection = await poolFor(credentials).getConnection();

    try {
      // As with Postgres, this is the layer that actually guarantees the query
      // cannot write, independent of any SQL text analysis.
      await connection.query("START TRANSACTION READ ONLY");
      // Applies to SELECTs only, which is all we ever run here. Set per
      // session because MySQL has no transaction-scoped equivalent.
      await connection.query(`SET SESSION max_execution_time = ${Number(timeoutMs)}`);

      const [rows, fields] = await connection.query<RowDataPacket[]>(sql);
      const columns = columnsFromFieldPackets(fields);
      const { rows: limited, truncated } = applyRowLimit(rows as unknown as RawRow[], rowLimit);

      return {
        columns,
        rows: normalizeRows(limited, columns),
        truncated,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      await connection.query("ROLLBACK").catch(() => undefined);
      // Clear the timeout so the next borrower of this pooled connection is
      // not silently subject to it.
      await connection.query("SET SESSION max_execution_time = DEFAULT").catch(() => undefined);
      connection.release();
    }
  },
};

function columnsFromFieldPackets(fields: FieldPacket[] | undefined): QueryColumn[] {
  return (fields ?? []).map((field) => ({
    name: field.name,
    type: normalizeMysqlType((field as { columnType?: number; type?: number }).columnType ?? (field as { type?: number }).type),
  }));
}

export function describeMysqlError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string } | null)?.code;

  if (code === "ER_QUERY_TIMEOUT" || /max_execution_time|query execution was interrupted/i.test(message)) {
    return "The query took too long and was cancelled. Narrow the time range or add an index.";
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return "Could not resolve the database host.";
  }
  if (code === "ECONNREFUSED") {
    return "The database refused the connection. Check the host, port and firewall rules.";
  }
  if (code === "ETIMEDOUT" || code === "PROTOCOL_CONNECTION_LOST") {
    return "Timed out connecting to the database. Check that it accepts connections from this network.";
  }
  if (code === "ER_ACCESS_DENIED_ERROR") {
    return "Authentication failed. Check the user and password.";
  }
  if (code === "ER_BAD_DB_ERROR") {
    return "That database does not exist on the server.";
  }
  if (code === "ER_CANT_EXECUTE_IN_READ_ONLY_TRANSACTION") {
    return "The query tried to modify data. Datasets must be read-only.";
  }
  return message;
}
