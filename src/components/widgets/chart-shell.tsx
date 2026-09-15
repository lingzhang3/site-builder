"use client";

import { useState, type ReactNode } from "react";

import { ResultTable } from "@/components/datasets/result-table";
import { cn } from "@/lib/cn";
import type { QueryResult } from "@/lib/connectors/types";

/**
 * The frame every widget renders inside: title, states, and the table toggle.
 *
 * The toggle is not a nice-to-have. Three of the light-mode series colors sit
 * below 3:1 contrast against the surface, which the palette validator reports
 * as a WARN carrying the "relief" obligation: the values must be reachable
 * without relying on the colour. The table view is that relief, and it doubles
 * as the accessible alternative to the hover layer.
 */
export function ChartShell({
  title,
  subtitle,
  result,
  notice,
  children,
  showTableToggle = true,
}: {
  title: string;
  subtitle?: string;
  /** Provided so the table view can show the same rows the chart plots. */
  result?: QueryResult;
  notice?: string;
  children: ReactNode;
  showTableToggle?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className="flex h-full min-h-0 flex-col gap-2 p-3">
      <figcaption className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium text-ink">{title}</h3>
          {subtitle ? <p className="truncate text-xs text-ink-subtle">{subtitle}</p> : null}
        </div>

        {showTableToggle && result ? (
          <button
            type="button"
            onClick={() => setShowTable((current) => !current)}
            aria-pressed={showTable}
            className={cn(
              "shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] transition-colors",
              showTable ? "bg-surface-muted text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            {showTable ? "Chart" : "Table"}
          </button>
        ) : null}
      </figcaption>

      {notice ? <p className="text-[11px] text-ink-subtle">{notice}</p> : null}

      <div className="min-h-0 flex-1 overflow-auto">
        {showTable && result ? <ResultTable result={result} maxRows={100} /> : children}
      </div>
    </figure>
  );
}

export function WidgetError({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <p className="max-w-xs text-center text-xs text-danger">{message}</p>
    </div>
  );
}

export function WidgetEmpty({ message = "No data" }: { message?: string }) {
  return (
    <div className="flex h-full items-center justify-center p-3">
      <p className="text-xs text-ink-subtle">{message}</p>
    </div>
  );
}
