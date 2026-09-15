"use client";

import type { QueryResult } from "@/lib/connectors/types";
import { Alert, Badge } from "@/components/ui";

/**
 * Renders a query result. Horizontally scrollable in its own container so a
 * wide result never makes the whole page scroll sideways.
 */
export function ResultTable({ result, maxRows = 200 }: { result: QueryResult; maxRows?: number }) {
  const rows = result.rows.slice(0, maxRows);

  if (result.columns.length === 0) {
    return <Alert tone="info">The query returned no columns.</Alert>;
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <span>
          {result.rows.length} row{result.rows.length === 1 ? "" : "s"} in {result.durationMs}ms
        </span>
        {result.truncated ? (
          <Badge tone="warning">Truncated at the row limit — add a LIMIT or aggregate</Badge>
        ) : null}
        {rows.length < result.rows.length ? (
          <span>Showing the first {rows.length}.</span>
        ) : null}
      </div>

      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-surface-muted">
            <tr>
              {result.columns.map((column) => (
                <th
                  key={column.name}
                  scope="col"
                  className="whitespace-nowrap border-b border-border px-2.5 py-2 font-medium text-ink"
                >
                  {column.name}
                  <span className="ml-1.5 font-normal text-ink-subtle">{column.type}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              // Query results have no stable identity, so the index is the key.
              <tr key={index} className="even:bg-surface-muted/40">
                {result.columns.map((column) => {
                  const value = row[column.name];
                  return (
                    <td
                      key={column.name}
                      className="max-w-xs truncate border-b border-border px-2.5 py-1.5 font-mono text-ink-muted"
                      title={value === null ? "null" : String(value)}
                    >
                      {value === null ? (
                        <span className="text-ink-subtle italic">null</span>
                      ) : (
                        String(value)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-ink-subtle">No rows matched.</p>
      ) : null}
    </div>
  );
}
