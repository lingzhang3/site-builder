/**
 * react-grid-layout's per-breakpoint position arrays, narrowed to the fields we
 * persist. Stored as jsonb on `dashboards.layout`.
 */

export interface GridItemPosition {
  /** Matches `widgets.id`. */
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Breakpoint = "lg" | "md" | "sm";

export type DashboardLayout = Partial<Record<Breakpoint, GridItemPosition[]>>;

export const GRID_COLUMNS: Record<Breakpoint, number> = { lg: 12, md: 8, sm: 4 };
export const GRID_BREAKPOINT_WIDTHS: Record<Breakpoint, number> = { lg: 1024, md: 768, sm: 0 };
export const GRID_ROW_HEIGHT = 30;

/**
 * Keeps a stored layout consistent with the widgets that actually exist:
 * drops positions for deleted widgets and appends newly created ones at the
 * bottom so nothing is invisible after a concurrent edit.
 */
export function reconcileLayout(
  layout: DashboardLayout,
  widgets: { id: string; defaultSize: { w: number; h: number } }[],
): DashboardLayout {
  const known = new Set(widgets.map((w) => w.id));
  const result: DashboardLayout = {};

  for (const breakpoint of ["lg", "md", "sm"] as Breakpoint[]) {
    const stored = (layout[breakpoint] ?? []).filter((item) => known.has(item.i));
    const placed = new Set(stored.map((item) => item.i));
    const columns = GRID_COLUMNS[breakpoint];

    let nextY = stored.reduce((max, item) => Math.max(max, item.y + item.h), 0);
    for (const widget of widgets) {
      if (placed.has(widget.id)) continue;
      const w = Math.min(widget.defaultSize.w, columns);
      stored.push({ i: widget.id, x: 0, y: nextY, w, h: widget.defaultSize.h });
      nextY += widget.defaultSize.h;
    }

    result[breakpoint] = stored;
  }

  return result;
}
