"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useRef, useState, useTransition } from "react";

import {
  deleteDatasetAction,
  previewQueryAction,
  saveDatasetAction,
} from "@/app/(app)/[orgSlug]/datasets/actions";
import { ResultTable } from "@/components/datasets/result-table";
import { SchemaBrowser } from "@/components/datasets/schema-browser";
import { Alert, Button, Input, Spinner } from "@/components/ui";
import { Modal } from "@/components/ui/modal";
import type { QueryResult } from "@/lib/connectors/types";

const SqlEditor = dynamic(() => import("@/components/datasets/sql-editor").then((m) => m.SqlEditor), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center rounded-md border border-border text-xs text-ink-muted">
      <Spinner />
    </div>
  ),
});

export function DatasetEditor({
  orgSlug,
  dataset,
  connection,
  editable,
}: {
  orgSlug: string;
  dataset: { id: string; name: string; sql: string };
  connection: { id: string; name: string; type: "postgres" | "mysql" };
  editable: boolean;
}) {
  const [name, setName] = useState(dataset.name);
  const [sqlText, setSqlText] = useState(dataset.sql);
  const [preview, setPreview] = useState<QueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [running, startRun] = useTransition();
  const [saving, startSave] = useTransition();

  // Read the latest SQL inside callbacks without making them change identity
  // on every keystroke.
  const sqlRef = useRef(sqlText);
  sqlRef.current = sqlText;

  const dirty = name !== dataset.name || sqlText !== dataset.sql;

  const run = useCallback(() => {
    setError(null);
    startRun(async () => {
      const result = await previewQueryAction(orgSlug, connection.id, sqlRef.current);
      if (result.error) {
        setError(result.error);
        setPreview(null);
      } else {
        setPreview(result.result ?? null);
      }
    });
  }, [orgSlug, connection.id]);

  const save = useCallback(() => {
    setError(null);
    startSave(async () => {
      const result = await saveDatasetAction(orgSlug, dataset.id, { name, sql: sqlRef.current });
      if (result.error) setError(result.error);
      else setSavedAt(result.savedAt ?? Date.now());
    });
  }, [orgSlug, dataset.id, name]);

  const insertSnippet = useCallback((snippet: string) => {
    // Replacing a starter query wholesale is what you want when clicking a
    // table; appending a bare column name is what you want for a column.
    setSqlText((current) =>
      snippet.startsWith("SELECT") ? snippet : `${current.replace(/\s*$/, "")} ${snippet}`,
    );
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/${orgSlug}/datasets`} className="text-sm text-ink-muted hover:text-ink">
            ← Datasets
          </Link>
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={!editable}
            aria-label="Dataset name"
            className="h-8 w-56"
          />
          <span className="hidden text-xs text-ink-subtle sm:inline">
            on {connection.name}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {savedAt && !dirty ? <span className="text-xs text-success">Saved</span> : null}
          {dirty ? <span className="text-xs text-ink-subtle">Unsaved changes</span> : null}

          <Button size="sm" onClick={run} disabled={running}>
            {running ? "Running…" : "Run"}
          </Button>

          {editable ? (
            <>
              <Button size="sm" variant="primary" onClick={save} disabled={saving || !dirty}>
                {saving ? "Saving…" : "Save"}
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirmingDelete(true)}>
                Delete
              </Button>
            </>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="h-[28rem] overflow-hidden rounded-md border border-border bg-surface">
          <SchemaBrowser
            orgSlug={orgSlug}
            connectionId={connection.id}
            onInsert={insertSnippet}
          />
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="h-[28rem]">
            <SqlEditor
              value={sqlText}
              onChange={setSqlText}
              dialect={connection.type}
              onRun={run}
            />
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          {preview ? (
            <ResultTable result={preview} />
          ) : (
            <p className="text-xs text-ink-subtle">
              Run the query (⌘/Ctrl + Enter) to preview the rows a widget will see.
            </p>
          )}
        </div>
      </div>

      <Modal
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete ${dataset.name}?`}
        description="Widgets built on it will show as unavailable."
      >
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmingDelete(false)}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => {
              void deleteDatasetAction(orgSlug, dataset.id);
            }}
          >
            Delete dataset
          </Button>
        </div>
      </Modal>
    </div>
  );
}
