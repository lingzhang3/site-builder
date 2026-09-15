"use client";

import { sql, PostgreSQL, MySQL } from "@codemirror/lang-sql";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

/**
 * CodeMirror is client-only and fairly large, so it lives behind its own
 * component; the dataset editor loads it with `next/dynamic` and shows a
 * textarea-shaped skeleton until it arrives.
 */
export function SqlEditor({
  value,
  onChange,
  dialect,
  onRun,
}: {
  value: string;
  onChange: (value: string) => void;
  dialect: "postgres" | "mysql";
  onRun: () => void;
}) {
  const extensions = useMemo(
    () => [sql({ dialect: dialect === "mysql" ? MySQL : PostgreSQL, upperCaseKeywords: true })],
    [dialect],
  );

  return (
    <div
      className="h-full overflow-hidden rounded-md border border-border"
      onKeyDown={(event) => {
        // Cmd/Ctrl+Enter runs, which is what every SQL console does.
        if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
          event.preventDefault();
          onRun();
        }
      }}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        height="100%"
        basicSetup={{ lineNumbers: true, foldGutter: false, highlightActiveLine: true }}
        className="h-full text-sm"
      />
    </div>
  );
}
