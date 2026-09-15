"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import type { QueryResult } from "@/lib/connectors/types";
import { formatAxisTick, formatCategory } from "@/lib/widgets/format";
import { shouldShowLegend } from "@/lib/widgets/palette";
import { TransformError, transformForChart } from "@/lib/widgets/transform";
import type { WidgetConfig } from "@/lib/widgets/types";
import { AXIS_PROPS, ChartLegend, ChartTooltip, GRID_PROPS } from "./chart-parts";
import { WidgetEmpty, WidgetError } from "./chart-shell";

/**
 * Line and bar share everything except the mark, so they share a component.
 *
 * Deliberately single-axis: plotting two measures of different magnitude on two
 * y-scales invents a correlation that is not in the data. Two measures that
 * cannot share a scale belong in two widgets.
 */
export function SeriesChart({
  kind,
  result,
  config,
}: {
  kind: "line" | "bar";
  result: QueryResult;
  config: WidgetConfig;
}) {
  let data;
  try {
    data = transformForChart(result, config);
  } catch (error) {
    return (
      <WidgetError
        message={error instanceof TransformError ? error.message : "Could not read the data."}
      />
    );
  }

  if (data.points.length === 0) return <WidgetEmpty />;

  // Recharts wants one flat object per point.
  const rows = data.points.map((point) => ({
    category: formatCategory(point.category),
    ...point.values,
  }));

  const legendEntries = data.series.map((name) => ({
    name,
    color: data.colors.get(name) ?? "var(--color-series-other)",
  }));

  const Chart = kind === "line" ? LineChart : BarChart;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <Chart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey="category" {...AXIS_PROPS} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...AXIS_PROPS} tickFormatter={formatAxisTick} width={44} />
            <Tooltip
              // Recharts' default cursor is a heavy filled block; a hairline
              // reads as the crosshair the method asks for.
              cursor={{ stroke: "var(--color-border-strong)", strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                return (
                  <ChartTooltip
                    label={String(label)}
                    format={config.format}
                    rows={payload.map((entry) => ({
                      name: String(entry.name ?? ""),
                      color: String(entry.color ?? "var(--color-series-other)"),
                      value: (entry.value ?? null) as number | null,
                    }))}
                  />
                );
              }}
            />

            {data.series.map((name) =>
              kind === "line" ? (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={data.colors.get(name)}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  // r=4 is an 8px marker; the surface-colored ring keeps it
                  // legible where lines cross.
                  dot={{ r: 4, strokeWidth: 2, stroke: "var(--color-surface)" }}
                  activeDot={{ r: 5, strokeWidth: 2, stroke: "var(--color-surface)" }}
                  // Gaps in the data are gaps, not zeros.
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ) : (
                <Bar
                  key={name}
                  dataKey={name}
                  fill={data.colors.get(name)}
                  // Rounded data-end, square at the baseline.
                  radius={[4, 4, 0, 0]}
                  maxBarSize={24}
                  stackId={config.stacked ? "stack" : undefined}
                  // The 2px separation between stacked segments, drawn in the
                  // surface color. This is the surface gap the method asks for,
                  // not a border: it subtracts ink rather than adding a
                  // contrasting outline, which SVG has no other way to express
                  // inside a stack.
                  stroke={config.stacked ? "var(--color-surface)" : undefined}
                  strokeWidth={config.stacked ? 2 : 0}
                  isAnimationActive={false}
                />
              ),
            )}
          </Chart>
        </ResponsiveContainer>
      </div>

      {shouldShowLegend(data.series.length) ? (
        <ChartLegend entries={legendEntries} markShape={kind === "line" ? "line" : "rect"} />
      ) : null}

      {data.droppedSeries.length > 0 ? (
        <p className="px-1 pt-1 text-[11px] text-ink-subtle">
          Not plotted: {data.droppedSeries.join(", ")} — eight series is the readable maximum.
        </p>
      ) : null}
    </div>
  );
}
