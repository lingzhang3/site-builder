/**
 * Shared shapes for talking to a customer database. Every connector
 * (`postgres`, `mysql`, and whatever comes later — REST, CSV, a SaaS API)
 * implements `Connector`, so the rest of the app never branches on source type.
 */

import type { ConnectionType } from "@/db/schema";

/** Credentials as entered by the customer. Encrypted before it touches the DB. */
export interface ConnectionCredentials {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  /** Postgres: `require` maps to TLS with no cert pinning. */
  ssl: boolean;
}

export interface QueryColumn {
  name: string;
  /** Normalized across engines so widgets can reason about it. */
  type: "number" | "string" | "boolean" | "date" | "unknown";
}

export type QueryRow = Record<string, string | number | boolean | null>;

export interface QueryResult {
  columns: QueryColumn[];
  rows: QueryRow[];
  /** True when the row cap kicked in and the result is incomplete. */
  truncated: boolean;
  durationMs: number;
}

export interface TableRef {
  schema: string;
  name: string;
}

export interface ColumnRef {
  name: string;
  dataType: string;
  nullable: boolean;
}

export interface TableSchema extends TableRef {
  columns: ColumnRef[];
}

export interface TestConnectionResult {
  ok: boolean;
  error?: string;
  /** Server version string, shown in the UI as proof the connection is live. */
  serverVersion?: string;
  /**
   * True when the supplied credentials can modify data. Not a failure, but the
   * UI warns: customers should give us a read-only role.
   */
  canWrite?: boolean;
}

export interface Connector {
  type: ConnectionType;
  testConnection(credentials: ConnectionCredentials): Promise<TestConnectionResult>;
  introspectSchema(credentials: ConnectionCredentials): Promise<TableSchema[]>;
  /**
   * Runs an already-validated read-only statement. Implementations MUST apply
   * the read-only transaction, statement timeout and row cap themselves —
   * application-level SQL checks are a first line of defence, not the only one.
   */
  runQuery(
    credentials: ConnectionCredentials,
    sql: string,
    options: { timeoutMs: number; rowLimit: number },
  ): Promise<QueryResult>;
}
