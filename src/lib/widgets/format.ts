/**
 * Number formatting for widget values.
 *
 * Kept pure and dependency-free (Intl only) so the rules are testable: a KPI
 * that renders "1.2999999999999998%" or "NaN" is the kind of thing that
 * destroys trust in a dashboard faster than a wrong colour ever will.
 */

import type { NumberFormat } from "./types";

const DEFAULT_FORMAT: NumberFormat = { style: "plain" };

export function formatValue(
  value: string | number | boolean | null | undefined,
  format: NumberFormat = DEFAULT_FORMAT,
): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";

  if (typeof value === "string") {
    const parsed = Number(value);
    // A string column that happens to hold numbers still formats as a number;
    // anything else is passed through as the label it is.
    if (value.trim() === "" || !Number.isFinite(parsed)) return value;
    return formatNumber(parsed, format);
  }

  return formatNumber(value, format);
}

export function formatNumber(value: number, format: NumberFormat = DEFAULT_FORMAT): string {
  if (!Number.isFinite(value)) return "—";

  const decimals = format.decimals;

  switch (format.style) {
    case "currency":
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: format.currency ?? "USD",
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 0,
      }).format(value);

    case "percent":
      // The value is already a percentage (42 means 42%), not a ratio: that is
      // what a `SELECT ... * 100.0 / total` query produces.
      return `${new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals ?? 1,
        maximumFractionDigits: decimals ?? 1,
      }).format(value)}%`;

    case "compact":
      return new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: decimals ?? 1,
      }).format(value);

    case "plain":
    default:
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: decimals ?? 0,
        maximumFractionDigits: decimals ?? 2,
      }).format(value);
  }
}

/**
 * Axis ticks get compact formatting regardless of the widget's own format, so
 * a y-axis reads "1.2M" rather than "1,200,000" and stays narrow.
 */
export function formatAxisTick(value: number): string {
  if (!Number.isFinite(value)) return "";
  if (value === 0) return "0";
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Category labels on an axis. Dates arrive as ISO strings from the connectors,
 * and a full ISO timestamp is unreadable on an axis, so they are shortened.
 */
export function formatCategory(value: string | number | boolean | null): string {
  if (value === null) return "—";
  if (typeof value !== "string") return String(value);

  const isoDate = /^(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?$/.exec(value);
  if (isoDate) {
    const [, year, month, day] = isoDate as unknown as [string, string, string, string];
    // Midnight on the first of a month is almost always a month bucket from
    // date_trunc, so label it as one.
    if (day === "01" && /T00:00/.test(value)) return `${year}-${month}`;
    return `${year}-${month}-${day}`;
  }

  return value;
}
