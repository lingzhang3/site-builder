"use client";

import type { ReactNode } from "react";

import { formatValue } from "@/lib/widgets/format";
import type { NumberFormat } from "@/lib/widgets/types";

/**
 * Shared chart chrome: the legend and the tooltip.
 *
 * Both follow two rules from the method that are easy to get wrong:
 *  - Text never wears the series color. Identity comes from a swatch or a short
 *    stroke *beside* the label; a light hue like yellow is illegible as text.
 *  - Series and category names come from customer SQL, so they are untrusted.
 *    Rendering them as React children escapes them; never build this markup by
 *    concatenating HTML strings.
 */

/** Legends mirror the mark: a rect for bars and fills, a short line for lines. */
export function ChartLegend({
  entries,
  markShape,
}: {
  /**
   * `value` is rendered after the name. Part-to-whole uses it to carry each
   * segment's share, because a 100% stacked bar's segments are all interior:
   * they have no free end for a label, and a label set on the fill itself
   * cannot clear contrast on every step of the palette. The legend is where
   * those numbers belong.
   */
  entries: { name: string; color: string; value?: string }[];
  markShape: "rect" | "line";
}) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 pt-1 text-xs">
      {entries.map((entry) => (
        <li key={entry.name} className="flex items-center gap-1.5">
          {markShape === "rect" ? (
            <span
              aria-hidden
              className="inline-block size-2.5 rounded-[2px]"
              style={{ backgroundColor: entry.color }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block h-0.5 w-3.5 rounded-full"
              style={{ backgroundColor: entry.color }}
            />
          )}
          <span className="text-ink-muted">{entry.name}</span>
          {entry.value ? (
            <span className="font-medium text-ink tabular-nums">{entry.value}</span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export interface TooltipRow {
  name: string;
  color: string;
  value: string | number | boolean | null;
}

/**
 * One tooltip listing every series at the hovered position, so the pointer
 * never has to land on a specific mark to read a value. The value leads and the
 * series name follows: here the reader already knows the series and wants the
 * number.
 */
export function ChartTooltip({
  label,
  rows,
  format,
}: {
  label: ReactNode;
  rows: TooltipRow[];
  format?: NumberFormat;
}) {
  return (
    <div className="pointer-events-none rounded-md border border-border bg-surface px-2.5 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-ink">{label}</p>
      <ul className="space-y-0.5">
        {rows.map((row) => (
          <li key={row.name} className="flex items-baseline gap-2">
            <span
              aria-hidden
              className="inline-block h-0.5 w-3 shrink-0 rounded-full"
              style={{ backgroundColor: row.color }}
            />
            <span className="font-medium text-ink">{formatValue(row.value, format)}</span>
            <span className="ml-auto pl-2 text-ink-subtle">{row.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Axis and grid styling, shared so every chart is chrome-consistent. */
export const AXIS_PROPS = {
  stroke: "var(--color-border-strong)",
  strokeWidth: 1,
  tick: { fill: "var(--color-ink-subtle)", fontSize: 11 },
  tickLine: false,
} as const;

/** Solid hairline, one step off the surface. Never dashed. */
export const GRID_PROPS = {
  stroke: "var(--color-border)",
  strokeWidth: 1,
  vertical: false,
} as const;
