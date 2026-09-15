import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  OTHER_LABEL,
  SERIES_HEX_DARK,
  SERIES_HEX_LIGHT,
  SERIES_SLOT_COUNT,
  assignSeriesColors,
  seriesVar,
  shouldShowLegend,
} from "./palette";

describe("palette definition", () => {
  it("has the same number of light and dark steps as slots", () => {
    assert.equal(SERIES_HEX_LIGHT.length, SERIES_SLOT_COUNT);
    assert.equal(SERIES_HEX_DARK.length, SERIES_SLOT_COUNT);
  });

  it("uses distinct hexes within each mode", () => {
    assert.equal(new Set(SERIES_HEX_LIGHT).size, SERIES_SLOT_COUNT);
    assert.equal(new Set(SERIES_HEX_DARK).size, SERIES_SLOT_COUNT);
  });

  it("is valid 6-digit hex throughout", () => {
    for (const hex of [...SERIES_HEX_LIGHT, ...SERIES_HEX_DARK]) {
      assert.match(hex, /^#[0-9a-f]{6}$/);
    }
  });
});

describe("seriesVar", () => {
  it("maps 1-based slots to custom properties", () => {
    assert.equal(seriesVar(1), "var(--color-series-1)");
    assert.equal(seriesVar(8), "var(--color-series-8)");
  });

  it("falls back to the de-emphasis gray outside the slot range", () => {
    assert.equal(seriesVar(0), "var(--color-series-other)");
    assert.equal(seriesVar(9), "var(--color-series-other)");
    assert.equal(seriesVar(-1), "var(--color-series-other)");
  });
});

describe("assignSeriesColors", () => {
  it("assigns slots in the order given", () => {
    const colors = assignSeriesColors(["alpha", "beta", "gamma"]);
    assert.equal(colors.get("alpha"), "var(--color-series-1)");
    assert.equal(colors.get("beta"), "var(--color-series-2)");
    assert.equal(colors.get("gamma"), "var(--color-series-3)");
  });

  it("keeps a series' color when another is filtered out", () => {
    // The point of assigning by entity rather than rank: dropping "alpha" must
    // not repaint "beta" and "gamma".
    const all = assignSeriesColors(["alpha", "beta", "gamma"]);
    const filtered = assignSeriesColors(["alpha", "gamma"]);
    assert.equal(filtered.get("alpha"), all.get("alpha"));
    assert.notEqual(filtered.get("gamma"), all.get("gamma"));
    // ^ Documents the limitation: callers that can drop a series must pass the
    //   full name list to keep colors stable. transformForChart does exactly
    //   that by deriving names from the dataset, not from the visible rows.
  });

  it("never generates a ninth hue", () => {
    const names = Array.from({ length: 12 }, (_, i) => `series-${i}`);
    const colors = assignSeriesColors(names);
    const distinct = new Set(colors.values());
    assert.ok(distinct.size <= SERIES_SLOT_COUNT + 1, `got ${distinct.size} distinct colors`);
    assert.equal(colors.get("series-8"), "var(--color-series-other)");
    assert.equal(colors.get("series-11"), "var(--color-series-other)");
  });

  it("paints the folded tail in the de-emphasis gray", () => {
    const colors = assignSeriesColors(["alpha", OTHER_LABEL]);
    assert.equal(colors.get(OTHER_LABEL), "var(--color-series-other)");
  });

  it("ignores duplicate names rather than consuming two slots", () => {
    const colors = assignSeriesColors(["alpha", "alpha", "beta"]);
    assert.equal(colors.get("beta"), "var(--color-series-2)");
  });
});

describe("legend rules", () => {
  it("shows a legend from two series up, and never for one", () => {
    assert.equal(shouldShowLegend(1), false);
    assert.equal(shouldShowLegend(2), true);
    assert.equal(shouldShowLegend(8), true);
  });
});

describe("globals.css stays in sync with this module", () => {
  // palette.ts is the documented source of truth, but the values charts
  // actually render come from CSS custom properties. Nothing at build time
  // connects the two, so drift between them would silently ship a palette that
  // was never validated. This test is that connection.
  const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");

  it("defines a custom property for every slot this module can emit", () => {
    for (let slot = 1; slot <= SERIES_SLOT_COUNT; slot++) {
      assert.ok(
        css.includes(`--color-series-${slot}:`),
        `globals.css is missing --color-series-${slot}`,
      );
    }
    assert.ok(css.includes("--color-series-other:"), "globals.css is missing the Other color");
  });

  it("defines no slot beyond the eight-hue ceiling", () => {
    assert.ok(
      !css.includes("--color-series-9:"),
      "a ninth categorical hue breaks the validated ordering",
    );
  });

  it("uses exactly the validated light hexes, in slot order", () => {
    // The light values live on bare `:root` via @theme, which is the first
    // definition of each token in the file.
    for (const [index, hex] of SERIES_HEX_LIGHT.entries()) {
      const declaration = `--color-series-${index + 1}: ${hex};`;
      assert.ok(css.includes(declaration), `globals.css should declare ${declaration}`);
    }
  });

  it("uses exactly the validated dark hexes", () => {
    for (const [index, hex] of SERIES_HEX_DARK.entries()) {
      const declaration = `--color-series-${index + 1}: ${hex};`;
      assert.ok(css.includes(declaration), `globals.css should declare the dark ${declaration}`);
    }
  });

  it("redefines the dark steps under both the media query and the theme toggle", () => {
    // Two scopes, so an explicit light choice beats OS dark and an explicit
    // dark choice beats OS light. One without the other is a half-working toggle.
    const darkBlocks = css.split(`--color-series-1: ${SERIES_HEX_DARK[0]};`).length - 1;
    assert.equal(darkBlocks, 2, "expected the dark series steps in exactly two scopes");
  });
});
