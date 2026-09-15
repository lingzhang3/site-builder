"use client";

import { useEffect, useState } from "react";

import { fetchSchemaAction } from "@/app/(app)/[orgSlug]/datasets/actions";
import { Alert, Spinner } from "@/components/ui";
import type { TableSchema } from "@/lib/connectors/types";

/**
 * Lists the customer's tables and columns. Loaded on the client rather than in
 * the server component, because introspecting a database on every page render
 * would make the editor slow to open and would query the customer's database
 * whether or not anyone looks at the list.
 */
export function SchemaBrowser({
  orgSlug,
  connectionId,
  onInsert,
}: {
  orgSlug: string;
  connectionId: string;
  onInsert: (snippet: string) => void;
}) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; error: string } | { status: "ready"; tables: TableSchema[] }
  >({ status: "loading" });
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    fetchSchemaAction(orgSlug, connectionId).then((result) => {
      if (cancelled) return;
      if (result.error) setState({ status: "error", error: result.error });
      else setState({ status: "ready", tables: result.tables ?? [] });
    });

    return () => {
      cancelled = true;
    };
  }, [orgSlug, connectionId]);

  if (state.status === "loading") {
    return (
      <div className="flex items-center gap-2 p-3 text-xs text-ink-muted">
        <Spinner /> Reading schema…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="p-3">
        <Alert tone="danger">{state.error}</Alert>
      </div>
    );
  }

  const needle = filter.trim().toLowerCase();
  const tables = needle
    ? state.tables.filter(
        (table) =>
          table.name.toLowerCase().includes(needle) ||
          table.columns.some((column) => column.name.toLowerCase().includes(needle)),
      )
    : state.tables;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border p-2">
        <input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter tables and columns"
          className="h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-ink placeholder:text-ink-subtle"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1">
        {tables.length === 0 ? (
          <p className="p-2 text-xs text-ink-subtle">No matching tables.</p>
        ) : (
          <ul className="space-y-0.5">
            {tables.map((table) => {
              const key = `${table.schema}.${table.name}`;
              const isOpen = expanded === key || needle.length > 0;
              return (
                <li key={key}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setExpanded(isOpen && !needle ? null : key)}
                      className="flex min-w-0 flex-1 items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-ink hover:bg-surface-muted"
                      aria-expanded={isOpen}
                    >
                      <span className="text-ink-subtle">{isOpen ? "▾" : "▸"}</span>
                      <span className="truncate font-medium">{table.name}</span>
                      <span className="ml-auto shrink-0 text-ink-subtle">
                        {table.columns.length}
                      </span>
                    </button>
                    <button
                      type="button"
                      title={`Insert a SELECT for ${table.name}`}
                      onClick={() => onInsert(starterQuery(table))}
                      className="rounded px-1.5 py-1 text-xs text-accent hover:bg-accent-soft"
                    >
                      use
                    </button>
                  </div>

                  {isOpen ? (
                    <ul className="mb-1 ml-5 space-y-0.5 border-l border-border pl-2">
                      {table.columns.map((column) => (
                        <li key={column.name}>
                          <button
                            type="button"
                            onClick={() => onInsert(column.name)}
                            className="flex w-full items-baseline gap-2 rounded px-1.5 py-0.5 text-left text-xs hover:bg-surface-muted"
                          >
                            <span className="truncate font-mono text-ink-muted">{column.name}</span>
                            <span className="ml-auto shrink-0 text-[10px] text-ink-subtle">
                              {column.dataType}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function starterQuery(table: TableSchema): string {
  const qualified = table.schema && table.schema !== "public" ? `${table.schema}.${table.name}` : table.name;
  return `SELECT *\nFROM ${qualified}\nLIMIT 100`;
}
