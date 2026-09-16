"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Responsive, WidthProvider, type Layout, type Layouts } from "react-grid-layout";

import {
  addWidgetAction,
  deleteWidgetAction,
  loadDashboardDataAction,
  saveLayoutAction,
  updateWidgetAction,
  type WidgetData,
} from "@/app/(app)/[orgSlug]/dashboards/actions";
import { PublishButton } from "@/components/dashboards/publish-button";
import { WidgetInspector, type DatasetOption } from "@/components/dashboards/widget-inspector";
import { WidgetRenderer } from "@/components/widgets/widget-renderer";
import { Alert, Button, Card, EmptyState, Spinner } from "@/components/ui";
import type { WidgetType } from "@/db/schema";
import { cn } from "@/lib/cn";
import {
  GRID_BREAKPOINT_WIDTHS,
  GRID_COLUMNS,
  GRID_ROW_HEIGHT,
  reconcileLayout,
  type DashboardLayout,
} from "@/lib/dashboards/types";
import {
  WIDGET_TYPE_LABELS,
  defaultConfigFor,
  defaultSizeFor,
  type WidgetConfig,
} from "@/lib/widgets/types";

const ResponsiveGrid = WidthProvider(Responsive);

const PALETTE: WidgetType[] = ["kpi", "line", "bar", "share", "table", "text"];

export interface EditorWidget {
  id: string;
  type: WidgetType;
  title: string;
  datasetId: string | null;
  config: WidgetConfig;
}

export function DashboardEditor({
  orgSlug,
  dashboard,
  initialWidgets,
  datasets,
  publication,
  canPublish,
}: {
  orgSlug: string;
  dashboard: { id: string; name: string; layout: DashboardLayout };
  initialWidgets: EditorWidget[];
  datasets: DatasetOption[];
  publication: { token: string; createdAt: string } | null;
  canPublish: boolean;
}) {
  const [widgets, setWidgets] = useState(initialWidgets);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [data, setData] = useState<Record<string, WidgetData>>({});
  const [loadingData, setLoadingData] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [, startAction] = useTransition();

  // Recomputed when widgets change, so a newly added widget gets a position
  // and a deleted one stops occupying space.
  const layouts = useMemo<Layouts>(() => {
    const reconciled = reconcileLayout(
      dashboard.layout,
      widgets.map((widget) => ({ id: widget.id, defaultSize: defaultSizeFor(widget.type) })),
    );
    const result: Layouts = {};
    for (const breakpoint of ["lg", "md", "sm"] as const) {
      result[breakpoint] = reconciled[breakpoint] ?? [];
    }
    return result;
  }, [dashboard.layout, widgets]);

  /** Runs every widget's query. Called on mount and from the Refresh button. */
  const refreshData = useCallback(() => {
    setLoadingData(true);
    loadDashboardDataAction(orgSlug, dashboard.id)
      .then(setData)
      .catch(() => setError("Could not load widget data."))
      .finally(() => setLoadingData(false));
  }, [orgSlug, dashboard.id]);

  useEffect(refreshData, [refreshData]);

  /* --- layout persistence ------------------------------------------------ */

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const persistLayout = useCallback(
    (allLayouts: Layouts) => {
      // react-grid-layout fires on every animation frame of a drag. Debouncing
      // means one write when the user lets go, not sixty during the gesture.
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        const trimmed: DashboardLayout = {};
        for (const breakpoint of ["lg", "md", "sm"] as const) {
          const items = allLayouts[breakpoint];
          if (!items) continue;
          trimmed[breakpoint] = items.map((item: Layout) => ({
            i: item.i,
            x: item.x,
            y: item.y,
            w: item.w,
            h: item.h,
          }));
        }
        void saveLayoutAction(orgSlug, dashboard.id, trimmed).then((result) => {
          if (result.error) setError(result.error);
        });
      }, 600);
    },
    [orgSlug, dashboard.id],
  );

  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    },
    [],
  );

  /* --- widget mutations -------------------------------------------------- */

  const addWidget = (type: WidgetType) =>
    startAction(async () => {
      const result = await addWidgetAction(orgSlug, dashboard.id, type);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (!result.widgetId) return;
      const widget: EditorWidget = {
        id: result.widgetId,
        type,
        title: "",
        datasetId: null,
        // Must match what addWidgetAction stored, or the first edit would
        // overwrite the server's defaults with an empty config.
        config: defaultConfigFor(type),
      };
      setWidgets((current) => [...current, widget]);
      setSelectedId(widget.id);
    });

  // One timer per widget: a shared timer would drop a pending save when the
  // user moves to a different widget mid-debounce.
  const widgetSaveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(
    () => () => {
      for (const timer of widgetSaveTimers.current.values()) clearTimeout(timer);
    },
    [],
  );

  const patchWidget = (
    widgetId: string,
    patch: { title?: string; datasetId?: string | null; config?: WidgetConfig },
  ) => {
    const current = widgets.find((widget) => widget.id === widgetId);
    if (!current) return;

    // Merged outside the state updater: updaters must stay pure, and under
    // StrictMode this one would otherwise schedule its save twice.
    const updated: EditorWidget = { ...current, ...patch };
    setWidgets((list) => list.map((widget) => (widget.id === widgetId ? updated : widget)));

    const timers = widgetSaveTimers.current;
    const existing = timers.get(widgetId);
    if (existing) clearTimeout(existing);

    timers.set(
      widgetId,
      setTimeout(() => {
        timers.delete(widgetId);
        void updateWidgetAction(orgSlug, dashboard.id, widgetId, {
          title: updated.title,
          datasetId: updated.datasetId,
          config: updated.config,
        }).then((result) => {
          if (result.error) setError(result.error);
          // A dataset or column change means the widget plots something new.
          else if (patch.datasetId !== undefined || patch.config) refreshData();
        });
      }, 500),
    );
  };

  const removeWidget = (widgetId: string) =>
    startAction(async () => {
      const result = await deleteWidgetAction(orgSlug, dashboard.id, widgetId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setWidgets((current) => current.filter((widget) => widget.id !== widgetId));
      setSelectedId((current) => (current === widgetId ? null : current));
    });

  const selected = widgets.find((widget) => widget.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/${orgSlug}/dashboards`} className="text-sm text-ink-muted hover:text-ink">
            ← Dashboards
          </Link>
          <h1 className="truncate text-lg font-semibold text-ink">{dashboard.name}</h1>
        </div>

        <div className="flex items-center gap-2">
          {loadingData ? <Spinner /> : null}
          <Button size="sm" onClick={refreshData} disabled={loadingData}>
            Refresh data
          </Button>
          {canPublish ? (
            <PublishButton
              orgSlug={orgSlug}
              dashboardId={dashboard.id}
              publication={publication}
            />
          ) : null}
        </div>
      </div>

      {error ? <Alert tone="danger">{error}</Alert> : null}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface p-2">
        <span className="px-1 text-xs text-ink-muted">Add:</span>
        {PALETTE.map((type) => (
          <Button key={type} size="sm" onClick={() => addWidget(type)}>
            {WIDGET_TYPE_LABELS[type]}
          </Button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_18rem]">
        <div className="min-w-0">
          {widgets.length === 0 ? (
            <EmptyState
              title="Empty dashboard"
              description="Add a widget above, then point it at one of your datasets."
            />
          ) : (
            <ResponsiveGrid
              className="-m-2"
              layouts={layouts}
              breakpoints={GRID_BREAKPOINT_WIDTHS}
              cols={GRID_COLUMNS}
              rowHeight={GRID_ROW_HEIGHT}
              margin={[8, 8]}
              containerPadding={[8, 8]}
              onLayoutChange={(_current, all) => persistLayout(all)}
              // Dragging from anywhere would make it impossible to interact
              // with a widget's own controls.
              draggableHandle="[data-drag-handle]"
              resizeHandles={["se"]}
            >
              {widgets.map((widget) => (
                <div key={widget.id}>
                  <Card
                    className={cn(
                      "flex h-full flex-col overflow-hidden transition-colors",
                      selectedId === widget.id ? "border-accent" : "",
                    )}
                  >
                    <div
                      data-drag-handle
                      onClick={() => setSelectedId(widget.id)}
                      className="flex h-6 shrink-0 cursor-move items-center justify-between border-b border-border bg-surface-muted px-2 text-[10px] text-ink-subtle"
                    >
                      <span className="truncate">
                        {widget.title || WIDGET_TYPE_LABELS[widget.type]}
                      </span>
                      <span aria-hidden>⋮⋮</span>
                    </div>

                    <div className="min-h-0 flex-1" onClick={() => setSelectedId(widget.id)}>
                      <WidgetRenderer
                        type={widget.type}
                        title={widget.title}
                        config={widget.config}
                        result={data[widget.id]?.result ?? null}
                        error={data[widget.id]?.error ?? null}
                        datasetName={
                          datasets.find((option) => option.id === widget.datasetId)?.name
                        }
                      />
                    </div>
                  </Card>
                </div>
              ))}
            </ResponsiveGrid>
          )}
        </div>

        <aside>
          <Card className="p-4">
            {selected ? (
              <WidgetInspector
                widget={selected}
                datasets={datasets}
                onChange={(patch) => patchWidget(selected.id, patch)}
                onDelete={() => removeWidget(selected.id)}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                Select a widget to configure it.
              </p>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}
