import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
  }
  return url;
}

// Next's dev server reloads modules on every edit; without this the process
// accumulates a new pool per reload until Postgres refuses connections.
const globalForDb = globalThis as unknown as { __appPool?: Pool };

const pool =
  globalForDb.__appPool ??
  new Pool({
    connectionString: requireDatabaseUrl(),
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__appPool = pool;
}

export const db = drizzle(pool, { schema });
export { schema };
