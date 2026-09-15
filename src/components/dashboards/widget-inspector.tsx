"use client";

import type { WidgetType } from "@/db/schema";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import type { QueryColumn } from "@/lib/connectors/types";
import { WIDGET_TYPE_LABELS, isDataWidget, type NumberFormat, type WidgetConfig } from "@/lib/widgets/types";

export interface DatasetOption {
  id: string;
  name: string;
  columns: QueryColumn[];
}

/**
 * Configures the selected widget: which dataset, which columns, how numbers
 * read. Column choices come from the dataset's recorded `resultSchema`, so the
 * inspector never has to re-query the customer's database to populate itself.
 */
export function WidgetInspector({
  widget,
  datasets,
  onChange,
  onDelete,
}: {
  widget: {
    id: string;
    type: WidgetType;
    title: string;
    datasetId: string | null;
    config: WidgetConfig;
  };
  datasets: DatasetOption[];
  onChange: (patch: {
    title?: string;
    datasetId?: string | null;
    config?: WidgetConfig;
  }) => void;
  onDelete: () => void;
}) {
  const dataset = datasets.find((candidate) => candidate.id === widget.datasetId);
  const columns = dataset?.columns ?? [];
  const numericColumns = columns.filter((column) => column.type === "number");
  const config = widget.config;

  const patchConfig = (patch: Partial<WidgetConfig>) =>
    onChange({ config: { ...config, ...patch } });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{WIDGET_TYPE_LABELS[widget.type]}</h2>
        <Button size="sm" variant="danger" onClick={onDelete}>
          Remove
        </Button>
      </div>

      <Field label="Title">
        <Input
          value={widget.title}
          onChange={(event) => onChange({ title: event.target.value })}
          placeholder={WIDGET_TYPE_LABELS[widget.type]}
        />
      </Field>

      {widget.type === "text" ? (
        <Field label="Text">
          <Textarea
            rows={6}
            value={config.body ?? ""}
            onChange={(event) => patchConfig({ body: event.target.value })}
            placeholder="Explain what this dashboard shows."
          />
        </Field>
      ) : null}

      {isDataWidget(widget.type) ? (
        <>
          <Field label="Dataset">
            <Select
              value={widget.datasetId ?? ""}
              onChange={(event) => onChange({ datasetId: event.target.value || null })}
            >
              <option value="">Select a dataset…</option>
              {datasets.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </Field>

          {dataset && columns.length === 0 ? (
            <p className="text-xs text-ink-subtle">
              This dataset has not been run yet. Open it and run the query to pick up its columns.
            </p>
          ) : null}

          {widget.type === "line" || widget.type === "bar" ? (
            <>
              <Field label="X axis" hint="Usually a date or a category.">
                <Select
                  value={config.dimension ?? ""}
                  onChange={(event) => patchConfig({ dimension: event.target.value || undefined })}
                >
                  <option value="">Auto</option>
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <MeasurePicker
                columns={numericColumns}
                selected={config.measures ?? []}
                onChange={(measures) => patchConfig({ measures })}
              />

              {widget.type === "bar" ? (
                <label className="flex items-center gap-2 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    checked={config.stacked ?? false}
                    onChange={(event) => patchConfig({ stacked: event.target.checked })}
                    className="size-4 accent-accent"
                  />
                  Stack the series
                </label>
              ) : null}
            </>
          ) : null}

          {widget.type === "share" ? (
            <>
              <Field label="Break down by">
                <Select
                  value={config.dimension ?? ""}
                  onChange={(event) => patchConfig({ dimension: event.target.value || undefined })}
                >
                  <option value="">Auto</option>
                  {columns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Size by" hint="Must be non-negative to read as parts of a whole.">
                <Select
                  value={config.measures?.[0] ?? ""}
                  onChange={(event) =>
                    patchConfig({ measures: event.target.value ? [event.target.value] : [] })
                  }
                >
                  <option value="">Auto</option>
                  {numericColumns.map((column) => (
                    <option key={column.name} value={column.name}>
                      {column.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          {widget.type === "kpi" ? (
            <Field label="Value" hint="The first row of this column is shown.">
              <Select
                value={config.measures?.[0] ?? ""}
                onChange={(event) =>
                  patchConfig({ measures: event.target.value ? [event.target.value] : [] })
                }
              >
                <option value="">Auto</option>
                {numericColumns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </Select>
            </Field>
          ) : null}

          {widget.type !== "table" ? (
            <FormatPicker
              format={config.format ?? { style: "compact" }}
              onChange={(format) => patchConfig({ format })}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function MeasurePicker({
  columns,
  selected,
  onChange,
}: {
  columns: QueryColumn[];
  selected: string[];
  onChange: (measures: string[]) => void;
}) {
  if (columns.length === 0) {
    return <p className="text-xs text-ink-subtle">This dataset has no numeric columns to plot.</p>;
  }

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs font-medium text-ink-muted">Series</legend>
      <p className="text-xs text-ink-subtle">
        Eight is the readable maximum; beyond that, colors stop being tellable apart.
      </p>
      <div className="max-h-40 space-y-1 overflow-y-auto">
        {columns.map((column) => {
          const checked = selected.includes(column.name);
          return (
            <label key={column.name} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={checked}
                onChange={() =>
                  // Order matters: it decides which color slot each series gets,
                  // so a series keeps its color when another is unchecked.
                  onChange(
                    checked
                      ? selected.filter((name) => name !== column.name)
                      : [...selected, column.name],
                  )
                }
                className="size-4 accent-accent"
              />
              <span className="truncate font-mono text-xs">{column.name}</span>
            </label>
          );
        })}
      </div>
      {selected.length === 0 ? (
        <p className="text-xs text-ink-subtle">Nothing selected — every numeric column is plotted.</p>
      ) : null}
    </fieldset>
  );
}

function FormatPicker({
  format,
  onChange,
}: {
  format: NumberFormat;
  onChange: (format: NumberFormat) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Number format">
        <Select
          value={format.style}
          onChange={(event) => onChange({ ...format, style: event.target.value as NumberFormat["style"] })}
        >
          <option value="compact">Compact (1.2M)</option>
          <option value="plain">Plain (1,200,000)</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
        </Select>
      </Field>

      {format.style === "currency" ? (
        <Field label="Currency">
          <Input
            value={format.currency ?? "USD"}
            onChange={(event) => onChange({ ...format, currency: event.target.value.toUpperCase() })}
            maxLength={3}
            placeholder="USD"
          />
        </Field>
      ) : (
        <Field label="Decimals">
          <Input
            type="number"
            min={0}
            max={6}
            value={format.decimals ?? ""}
            onChange={(event) =>
              onChange({
                ...format,
                decimals: event.target.value === "" ? undefined : Number(event.target.value),
              })
            }
            placeholder="Auto"
          />
        </Field>
      )}
    </div>
  );
}
