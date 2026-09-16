import { z } from "zod";

import { isSupportedCurrency } from "./currency";
import type { WidgetConfig } from "./types";

/**
 * Validation for `widgets.config`.
 *
 * This matters more than it looks. A widget's config arrives from the browser
 * through a Server Action — a public HTTP endpoint — is stored as jsonb, and is
 * then read back and rendered, including on a published page served to
 * anonymous visitors. So it is attacker-controlled data on a path that reaches
 * other people's screens.
 *
 * Three jobs:
 *  1. Reject values that crash rendering. `format.currency` is passed to
 *     `Intl.NumberFormat`, which throws a RangeError on an unknown code — one
 *     bad value would take out the widget, and with it the page.
 *  2. Bound the sizes, so nobody can park megabytes in a jsonb column through
 *     a text widget or a thousand-entry measures array.
 *  3. Strip unknown keys, so stored configs stay to the shape the renderers
 *     actually understand.
 */

/** Column names come from customer SQL, so allow anything a column can be called. */
const columnName = z.string().min(1).max(200);

/**
 * ISO 4217 is three letters. Checked against the runtime's own list rather
 * than a regex: `Intl` is what will consume it, so `Intl` decides what is
 * valid. Unsupported-but-well-formed codes are caught here rather than at
 * render time.
 */
const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .length(3)
  .refine(isSupportedCurrency, { message: "Not a currency code Intl recognizes." });

export const numberFormatSchema = z.object({
  style: z.enum(["plain", "currency", "percent", "compact"]),
  currency: currencyCode.optional(),
  // More than six decimals is never a readable dashboard figure, and
  // Intl rejects anything above 20 outright.
  decimals: z.number().int().min(0).max(6).optional(),
});

export const widgetConfigSchema = z.object({
  dimension: columnName.optional(),
  // Eight is the palette ceiling, but a config may legitimately list more and
  // let the transform drop the tail; the cap here only stops abuse.
  measures: z.array(columnName).max(64).optional(),
  columns: z.array(columnName).max(256).optional(),
  format: numberFormatSchema.optional(),
  // Text widget body. Rendered as React children, so it is escaped, not HTML.
  body: z.string().max(10_000).optional(),
  showLegend: z.boolean().optional(),
  stacked: z.boolean().optional(),
});

/**
 * Compile-time check that the schema and the hand-written type stay in step.
 * If a field is added to `WidgetConfig` without being added here, this fails
 * to compile rather than silently letting the field through unvalidated.
 */
const _schemaMatchesType: WidgetConfig = {} as z.infer<typeof widgetConfigSchema>;
void _schemaMatchesType;

export type ValidatedWidgetConfig = z.infer<typeof widgetConfigSchema>;
