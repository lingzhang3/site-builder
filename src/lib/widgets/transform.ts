/**
 * Turns a query result into the arrays a chart renders, applying the series
 * rules from the data-viz method. Pure, so the rules are unit-testable rather
 * than tangled up in a React component.
 */

import type { QueryColumn, QueryResult, QueryRow } from "@/lib/connectors/types";
import { OTHER_LABEL, SERIES_SLOT_COUNT, assignSeriesColors } from "./palette";
import type { WidgetConfig } from "./types";

/** Part-to-whole is only readable at a glance up to a handful of segments. */
export const MAX_SHARE_SEGMENTS = 6;

export interface ChartPoint {
  category: string;
  /** One entry per series name. */
  values: Record<string, number | null>;
}

export interface ChartData {
  points: ChartPoint[];
  /** Series names in a stable order; drives both legend and colors. */
  series: string[];
  colors: Map<string, string>;
  /** Measures the config asked for that exceeded the eight-slot ceiling. */
  droppedSeries: string[];
}

export interface ShareSegment {
  label: string;
  value: number;
  /** 0–100. */
  percent: number;
  color: string;
}

export interface ShareData {
  segments: ShareSegment[];
  total: number;
  /** True when a tail of small categories was summed into "Other". */
  folded: boolean;
}

export class TransformError extends Error {}

function numericColumns(columns: QueryColumn[]): string[] {
  return columns.filter((column) => column.type === "number").map((column) => column.name);
}

function firstNonNumericColumn(columns: QueryColumn[]): string | undefined {
  return columns.find((column) => column.type !== "number")?.name;
}

/** Resolves a config against a real result, falling back to sensible columns. */
export function resolveFields(
  result: QueryResult,
  config: WidgetConfig,
): { dimension: string | undefined; measures: string[] } {
  const available = new Set(result.columns.map((column) => column.name));

  const dimension =
    config.dimension && available.has(config.dimension)
      ? config.dimension
      : firstNonNumericColumn(result.columns);

  const requested = (config.measures ?? []).filter((measure) => available.has(measure));
  const measures =
    requested.length > 0
      ? requested
      : numericColumns(result.columns).filter((name) => name !== dimension);

  return { dimension, measures };
}

/**
 * Accepts `undefined` as well as the row value type: under
 * `noUncheckedIndexedAccess`, looking a column up on a row can legitimately
 * miss (a widget configured against a column the query no longer returns), and
 * that should read as "no value" rather than crash the widget.
 */
function toNumber(value: QueryRow[string] | undefined): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Wide-format transform for line and bar widgets: each measure column is a
 * series, each row is a point on the category axis.
 *
 * Measures past the eighth are dropped rather than given a generated hue — a
 * ninth categorical color is indistinguishable from an existing one under
 * colorblind simulation. The names come back in `droppedSeries` so the UI can
 * say so instead of silently hiding data.
 */
export function transformForChart(result: QueryResult, config: WidgetConfig): ChartData {
  const { dimension, measures } = resolveFields(result, config);

  if (measures.length === 0) {
    throw new TransformError("Pick at least one numeric column to plot.");
  }

  const series = measures.slice(0, SERIES_SLOT_COUNT);
  const droppedSeries = measures.slice(SERIES_SLOT_COUNT);

  const points: ChartPoint[] = result.rows.map((row, index) => {
    const rawCategory = dimension ? row[dimension] : null;
    const values: Record<string, number | null> = {};
    for (const measure of series) {
      values[measure] = toNumber(row[measure]);
    }
    return {
      // Without a dimension the row index is the only ordering available.
      category: rawCategory === null || rawCategory === undefined ? String(index + 1) : String(rawCategory),
      values,
    };
  });

  return {
    points,
    series,
    // Colors are derived from the full requested measure list, so hiding a
    // series later does not repaint the survivors.
    colors: assignSeriesColors(measures),
    droppedSeries,
  };
}

/**
 * Part-to-whole transform: categories come from the dimension, sizes from one
 * measure. The tail beyond `MAX_SHARE_SEGMENTS` is summed into "Other", which
 * is the correct fold here because the segments are parts of one quantity.
 */
export function transformForShare(result: QueryResult, config: WidgetConfig): ShareData {
  const { dimension, measures } = resolveFields(result, config);
  const measure = measures[0];

  if (!dimension) throw new TransformError("Pick a column to break the total down by.");
  if (!measure) throw new TransformError("Pick a numeric column to size the segments.");

  const totals = new Map<string, number>();
  for (const row of result.rows) {
    const value = toNumber(row[measure]);
    if (value === null) continue;
    if (value < 0) {
      throw new TransformError(
        "This breakdown contains negative values, which cannot be read as parts of a whole. Use a bar chart instead.",
      );
    }
    const label = String(row[dimension] ?? "—");
    totals.set(label, (totals.get(label) ?? 0) + value);
  }

  const ordered = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const head = ordered.slice(0, MAX_SHARE_SEGMENTS);
  const tail = ordered.slice(MAX_SHARE_SEGMENTS);

  const labels = head.map(([label]) => label);
  if (tail.length > 0) labels.push(OTHER_LABEL);
  const colors = assignSeriesColors(labels);

  const entries: [string, number][] = [...head];
  if (tail.length > 0) {
    entries.push([OTHER_LABEL, tail.reduce((sum, [, value]) => sum + value, 0)]);
  }

  const total = entries.reduce((sum, [, value]) => sum + value, 0);

  return {
    segments: entries.map(([label, value]) => ({
      label,
      value,
      // A zero total would otherwise produce NaN widths.
      percent: total > 0 ? (value / total) * 100 : 0,
      color: colors.get(label) ?? "var(--color-series-other)",
    })),
    total,
    folded: tail.length > 0,
  };
}

/** Single headline number for a KPI tile: the first measure of the first row. */
export function transformForKpi(
  result: QueryResult,
  config: WidgetConfig,
): { value: number | null; label: string } {
  const { measures } = resolveFields(result, config);
  const measure = measures[0];

  if (!measure) throw new TransformError("Pick a numeric column to show.");

  const firstRow = result.rows[0];
  return {
    value: firstRow ? toNumber(firstRow[measure]) : null,
    label: measure,
  };
}
