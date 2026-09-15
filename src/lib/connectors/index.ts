import type { ConnectionType } from "@/db/schema";

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
export const DIALECTS: Record<ConnectionType, "postgres" | "mysql"> = {
  postgres: "postgres",
  mysql: "mysql",
};

export const CONNECTION_TYPE_LABELS: Record<ConnectionType, string> = {
  postgres: "PostgreSQL",
  mysql: "MySQL",
};

export type { Connector } from "./types";
