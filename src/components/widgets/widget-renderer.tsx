"use client";

import type { QueryResult } from "@/lib/connectors/types";
import type { WidgetType } from "@/db/schema";
import type { WidgetConfig } from "@/lib/widgets/types";
import { ChartShell, WidgetEmpty, WidgetError } from "./chart-shell";
import { KpiCard } from "./kpi-card";
import { SeriesChart } from "./series-chart";
import { ShareBar } from "./share-bar";
import { ResultTable } from "@/components/datasets/result-table";

/**
 * Renders one widget from a query result. Shared by the editor canvas and the
 * public page, so a published dashboard can never drift from its preview.
 */
export function WidgetRenderer({
  type,
  title,
  config,
  result,
  error,
  datasetName,
}: {
  type: WidgetType;
  title: string;
  config: WidgetConfig;
  result: QueryResult | null;
  /** Set when the query failed; the widget shows why rather than going blank. */
  error?: string | null;
  datasetName?: string;
}) {
  if (type === "text") {
    return (
      <div className="h-full overflow-auto p-4">
        {title ? <h3 className="text-sm font-medium text-ink">{title}</h3> : null}
        {config.body ? (
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{config.body}</p>
        ) : (
          <p className="mt-1 text-sm text-ink-subtle">Add some text in the inspector.</p>
        )}
      </div>
    );
  }

  if (error) return <WidgetError message={error} />;
  if (!result) return <WidgetEmpty message="No dataset selected" />;

  // The KPI tile is the one form with no plot, so it needs no table toggle:
  // the number is already right there in full.
  if (type === "kpi") {
    return <KpiCard title={title} result={result} config={config} />;
  }

  if (type === "table") {
    return (
      <ChartShell title={title} subtitle={datasetName} showTableToggle={false}>
        <ResultTable result={result} maxRows={100} />
      </ChartShell>
    );
  }

  return (
    <ChartShell
      title={title}
      subtitle={datasetName}
      result={result}
      notice={
        result.truncated
          ? "Showing a truncated result — aggregate in the query for an accurate chart."
          : undefined
      }
    >
      {type === "share" ? (
        <ShareBar result={result} config={config} />
      ) : (
        <SeriesChart kind={type} result={result} config={config} />
      )}
    </ChartShell>
  );
}
