import type { ConnectionType } from "@/db/schema";

import type { SqlDialect } from "@/lib/query/guard";

import { mysqlConnector } from "./mysql";
import { postgresConnector } from "./postgres";
import type { Connector } from "./types";

/**
 * The single place the app learns about data sources. Adding CSV upload, a REST
 * connector or a SaaS OAuth connector means implementing `Connector` and adding
 * it here — no call site needs to change.
 */
const CONNECTORS: Record<ConnectionType, Connector> = {
  postgres: postgresConnector,
  mysql: mysqlConnector,
};

export function getConnector(type: ConnectionType): Connector {
  const connector = CONNECTORS[type];
  if (!connector) throw new Error(`No connector registered for type "${type}".`);
  return connector;
}

export const DEFAULT_PORTS: Record<ConnectionType, number> = {
  postgres: 5432,
  mysql: 3306,
};

/** SQL dialect each connection type speaks, for the read-only guard. */
const DIALECTS: Record<ConnectionType, SqlDialect> = {
  postgres: "postgres",
  mysql: "mysql",
};

/**
 * Narrowing accessor rather than a bare lookup: the guard must never be handed
 * an undefined dialect, because that is the argument that decides which
 * comment and quoting rules it applies.
 */
export function getDialect(type: ConnectionType): SqlDialect {
  const dialect = DIALECTS[type];
  if (!dialect) throw new Error(`No SQL dialect registered for type "${type}".`);
  return dialect;
}

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

export type { Connector } from "./types";
