/**
 * Categorical series colors.
 *
 * These eight hues and their dark-mode steps are a validated set: run
 *   node scripts/validate_palette.js "<hex,...>" --mode light  --surface "#ffffff"
 *   node scripts/validate_palette.js "<hex,...>" --mode dark   --surface "#16181d"
 * and every check passes on the adjacent pairlist used by lines, bars and
 * stacks (worst adjacent CVD ΔE 9.1 light / 8.4 dark against a ≥8 target).
 *
 * Two rules this module exists to enforce:
 *
 *  1. **Slot order is fixed and never cycled.** The ordering is what makes the
 *     set colorblind-safe, so a 9th series is not a new hue — it folds into
 *     "Other". Generating a hue past slot 8 would be indistinguishable from an
 *     existing one under CVD.
 *  2. **Color follows the entity, not its rank.** Slots are assigned from a
 *     stable ordering of series names, so filtering one series out does not
 *     repaint the others. A reader who learned "enterprise is blue" keeps it.
 *
 * Charts reference the CSS custom properties rather than these hex values, so
 * light and dark swap without JavaScript. The hexes here are the source of
 * truth that globals.css and the validator are checked against.
 */

export const SERIES_SLOT_COUNT = 8;

/** Light-mode steps. Index 0 is slot 1. */
export const SERIES_HEX_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

/** The same eight hues, stepped for the dark surface. Not an automatic flip. */
export const SERIES_HEX_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

/** Anything past slot 8, and the folded tail, is de-emphasis gray. */
export const OTHER_LABEL = "Other";

/**
 * CSS custom property for a slot, so the SVG mark picks up the theme. Slots are
 * 1-based to match the palette documentation.
 */
export function seriesVar(slot: number): string {
  if (slot < 1 || slot > SERIES_SLOT_COUNT) return "var(--color-series-other)";
  return `var(--color-series-${slot})`;
}

/**
 * Assigns each series name a stable slot.
 *
 * `names` is used in the order given (which callers derive from the data, not
 * from magnitude), so the mapping is deterministic. Names past the eighth all
 * map to the "other" slot.
 */
export function assignSeriesColors(names: string[]): Map<string, string> {
  const colors = new Map<string, string>();
  let slot = 0;

  for (const name of names) {
    if (colors.has(name)) continue;
    if (name === OTHER_LABEL) {
      colors.set(name, "var(--color-series-other)");
      continue;
    }
    slot += 1;
    colors.set(name, seriesVar(slot));
  }

  return colors;
}

/**
 * A legend is always present for two or more series — identity must never rest
 * on color alone. A single series needs none: the widget title already says
 * what is plotted, and a one-swatch box just restates it.
 */
export function shouldShowLegend(seriesCount: number): boolean {
  return seriesCount >= 2;
}

/*
 * Selective direct labels (a value at a line's endpoint, for four series or
 * fewer) are a deliberate gap. They are the method's preferred supplement to
 * the legend, but placing them correctly means checking for collisions in a
 * rendered chart, and shipping label-positioning code that has never been
 * looked at is worse than not shipping it. Until then the legend, the hover
 * tooltip and the table view carry every value.
 */
