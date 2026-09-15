"use client";

import { useMemo } from "react";
import { Responsive, WidthProvider, type Layouts } from "react-grid-layout";

import { WidgetRenderer } from "@/components/widgets/widget-renderer";
import { Card, EmptyState } from "@/components/ui";
import {
  GRID_BREAKPOINT_WIDTHS,
  GRID_COLUMNS,
  GRID_ROW_HEIGHT,
  reconcileLayout,
  type DashboardLayout,
} from "@/lib/dashboards/types";
import { defaultSizeFor } from "@/lib/widgets/types";
import type { PublicWidget } from "@/lib/publications";

const ResponsiveGrid = WidthProvider(Responsive);

/**
 * Read-only rendering of a published dashboard. Uses the same grid and the same
 * WidgetRenderer as the editor, so what a viewer sees cannot drift from what
 * the author arranged.
 */
export function PublicDashboard({
  layout,
  widgets,
}: {
  layout: DashboardLayout;
  widgets: PublicWidget[];
}) {
  const layouts = useMemo<Layouts>(() => {
    const reconciled = reconcileLayout(
      layout,
      widgets.map((widget) => ({ id: widget.id, defaultSize: defaultSizeFor(widget.type) })),
    );
    const result: Layouts = {};
    for (const breakpoint of ["lg", "md", "sm"] as const) {
      result[breakpoint] = reconciled[breakpoint] ?? [];
    }
    return result;
  }, [layout, widgets]);

  if (widgets.length === 0) {
    return <EmptyState title="This dashboard is empty" />;
  }

  return (
    <ResponsiveGrid
      layouts={layouts}
      breakpoints={GRID_BREAKPOINT_WIDTHS}
      cols={GRID_COLUMNS}
      rowHeight={GRID_ROW_HEIGHT}
      margin={[8, 8]}
      containerPadding={[8, 8]}
      isDraggable={false}
      isResizable={false}
    >
      {widgets.map((widget) => (
        <div key={widget.id}>
          <Card className="flex h-full flex-col overflow-hidden">
            <WidgetRenderer
              type={widget.type}
              title={widget.title}
              config={widget.config}
              result={widget.result}
              error={widget.error}
              datasetName={widget.datasetName ?? undefined}
            />
          </Card>
        </div>
      ))}
    </ResponsiveGrid>
  );
}
