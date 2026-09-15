"use client";

import type { QueryResult } from "@/lib/connectors/types";
import { formatValue } from "@/lib/widgets/format";
import { TransformError, transformForKpi } from "@/lib/widgets/transform";
import type { WidgetConfig } from "@/lib/widgets/types";
import { WidgetError } from "./chart-shell";

/**
 * A single headline number. This is the right form for one value — a one-bar
 * bar chart says the same thing with far more ink and a legend nobody needs.
 */
export function KpiCard({
  title,
  result,
  config,
}: {
  title: string;
  result: QueryResult;
  config: WidgetConfig;
}) {
  let kpi: { value: number | null; label: string };
  try {
    kpi = transformForKpi(result, config);
  } catch (error) {
    return <WidgetError message={error instanceof TransformError ? error.message : "Could not read the value."} />;
  }

  return (
    <div className="flex h-full flex-col justify-center p-4">
      <p className="text-xs text-ink-muted">{title || kpi.label}</p>
      <p className="mt-1 text-3xl font-semibold tracking-tight text-ink tabular-nums">
        {formatValue(kpi.value, config.format)}
      </p>
      {result.rows.length > 1 ? (
        <p className="mt-1 text-[11px] text-ink-subtle">
          First of {result.rows.length} rows — add an aggregate to the query for a single value.
        </p>
      ) : null}
    </div>
  );
}
