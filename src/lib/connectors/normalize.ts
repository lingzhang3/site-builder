/**
 * Turns driver-shaped rows into something a chart and `JSON.stringify` can both
 * handle. Two problems this solves:
 *
 *  1. Both drivers hand back values that are not JSON-safe — `Date` objects,
 *     `Buffer`s, `bigint`s — and these rows cross the server/client boundary.
 *  2. Postgres returns `bigint` and `numeric` as strings to avoid precision
 *     loss, so a perfectly good revenue column arrives as "129900" and a chart
 *     silently plots nothing. Columns we have typed as numeric are coerced.
 *
 * Dependency-free so it can be unit-tested without a database.
 */

import type { QueryColumn, QueryRow } from "./types";

/** Values a driver might hand us before normalization. */
export type RawValue = unknown;
export type RawRow = Record<string, RawValue>;

export function normalizeValue(value: RawValue, columnType: QueryColumn["type"]): QueryRow[string] {
  if (value === null || value === undefined) return null;

  if (value instanceof Date) {
    // Invalid dates stringify to "Invalid Date"; emit null instead.
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  if (typeof value === "bigint") {
    // Beyond 2^53 a JS number is no longer exact, so keep those as text rather
    // than silently rounding someone's revenue figure.
    return value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : value.toString();
  }

  if (value instanceof Uint8Array) {
    return `\\x${Buffer.from(value).toString("hex")}`;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    if (columnType === "number") {
      const parsed = Number(value);
      // Keep the original text when it does not round-trip: a numeric with
      // more precision than a double, or a value that is not really a number.
      if (value.trim() !== "" && Number.isFinite(parsed) && String(parsed) === value.trim()) {
        return parsed;
      }
      return value;
    }
    return value;
  }

  // Arrays, json/jsonb columns, geometry, anything else: render as text so the
  // table widget can show it without the page crashing.
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function normalizeRows(rows: RawRow[], columns: QueryColumn[]): QueryRow[] {
  const typeByName = new Map(columns.map((column) => [column.name, column.type]));

  return rows.map((row) => {
    const normalized: QueryRow = {};
    for (const [key, value] of Object.entries(row)) {
      normalized[key] = normalizeValue(value, typeByName.get(key) ?? "unknown");
    }
    return normalized;
  });
}

/**
 * Applies the row cap. Callers run `LIMIT rowLimit + 1`, so receiving more than
 * `rowLimit` rows is how we know the result was cut short.
 */
export function applyRowLimit<T>(rows: T[], rowLimit: number): { rows: T[]; truncated: boolean } {
  if (rows.length > rowLimit) {
    return { rows: rows.slice(0, rowLimit), truncated: true };
  }
  return { rows, truncated: false };
}
