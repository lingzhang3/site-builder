import type { WidgetType } from "@/db/schema";

/** How a widget turns dataset columns into marks. */
export interface WidgetConfig {
  /** Category / x axis column. Unused by `kpi` and `text`. */
  dimension?: string;
  /** Value columns. `kpi` reads the first; charts render one series each. */
  measures?: string[];
  /** Columns to show, in order. `table` only; empty means "all". */
  columns?: string[];
  /** Applied to numeric output. */
  format?: NumberFormat;
  /** `text` widgets only. */
  body?: string;
  /** Charts only: draw a legend. Defaults to true when >1 measure. */
  showLegend?: boolean;
  /** Charts only: stack series instead of grouping them. */
  stacked?: boolean;
}

export interface NumberFormat {
  style: "plain" | "currency" | "percent" | "compact";
  /** ISO 4217 code, `currency` only. */
  currency?: string;
  decimals?: number;
}

export const WIDGET_TYPE_LABELS: Record<WidgetType, string> = {
  kpi: "KPI",
  line: "Line chart",
  bar: "Bar chart",
  share: "Share of total",
  table: "Table",
  text: "Text",
};

/** Widget types that render a dataset and therefore need one assigned. */
export const DATA_WIDGET_TYPES: WidgetType[] = ["kpi", "line", "bar", "share", "table"];

export function isDataWidget(type: WidgetType): boolean {
  return DATA_WIDGET_TYPES.includes(type);
}

export function defaultConfigFor(type: WidgetType): WidgetConfig {
  switch (type) {
    case "kpi":
      return { measures: [], format: { style: "compact" } };
    case "line":
    case "bar":
      return { measures: [], format: { style: "compact" }, showLegend: true };
    case "share":
      return { measures: [], format: { style: "compact" } };
    case "table":
      return { columns: [] };
    case "text":
      return { body: "" };
  }
}

/** Default grid footprint, in react-grid-layout units (12-column grid). */
export function defaultSizeFor(type: WidgetType): { w: number; h: number } {
  switch (type) {
    case "kpi":
      return { w: 3, h: 4 };
    case "table":
      return { w: 12, h: 10 };
    case "text":
      return { w: 6, h: 3 };
    default:
      return { w: 6, h: 8 };
  }
}
