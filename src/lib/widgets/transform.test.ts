import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { QueryResult } from "../connectors/types";
import { OTHER_LABEL } from "./palette";
import {
  MAX_SHARE_SEGMENTS,
  TransformError,
  resolveFields,
  transformForChart,
  transformForKpi,
  transformForShare,
} from "./transform";

function makeResult(
  columns: QueryResult["columns"],
  rows: QueryResult["rows"],
): QueryResult {
  return { columns, rows, truncated: false, durationMs: 1 };
}

const monthly = makeResult(
  [
    { name: "month", type: "date" },
    { name: "mrr", type: "number" },
    { name: "new_mrr", type: "number" },
  ],
  [
    { month: "2026-01-01", mrr: 1000, new_mrr: 100 },
    { month: "2026-02-01", mrr: 1200, new_mrr: 200 },
  ],
);

describe("resolveFields", () => {
  it("falls back to the first non-numeric column and all numeric columns", () => {
    assert.deepEqual(resolveFields(monthly, {}), {
      dimension: "month",
      measures: ["mrr", "new_mrr"],
    });
  });

  it("honours an explicit config", () => {
    assert.deepEqual(resolveFields(monthly, { dimension: "month", measures: ["mrr"] }), {
      dimension: "month",
      measures: ["mrr"],
    });
  });

  it("ignores columns the query no longer returns", () => {
    // A dataset's SQL can change after a widget was configured against it.
    const resolved = resolveFields(monthly, { dimension: "gone", measures: ["mrr", "also_gone"] });
    assert.equal(resolved.dimension, "month");
    assert.deepEqual(resolved.measures, ["mrr"]);
  });
});

describe("transformForChart", () => {
  it("maps each measure to a series and each row to a point", () => {
    const data = transformForChart(monthly, {});
    assert.deepEqual(data.series, ["mrr", "new_mrr"]);
    assert.equal(data.points.length, 2);
    assert.equal(data.points[0]?.category, "2026-01-01");
    assert.deepEqual(data.points[0]?.values, { mrr: 1000, new_mrr: 100 });
  });

  it("assigns colors in slot order", () => {
    const data = transformForChart(monthly, {});
    assert.equal(data.colors.get("mrr"), "var(--color-series-1)");
    assert.equal(data.colors.get("new_mrr"), "var(--color-series-2)");
  });

  it("coerces numeric strings, since pg returns bigint as text", () => {
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "total", type: "number" },
      ],
      [{ plan: "growth", total: "24900" }],
    );
    assert.equal(transformForChart(result, {}).points[0]?.values.total, 24900);
  });

  it("renders an unparseable value as null rather than NaN", () => {
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "total", type: "number" },
      ],
      [{ plan: "growth", total: "n/a" }],
    );
    assert.equal(transformForChart(result, {}).points[0]?.values.total, null);
  });

  it("drops measures past the eighth instead of generating a ninth hue", () => {
    const columns = Array.from({ length: 10 }, (_, i) => ({
      name: `m${i}`,
      type: "number" as const,
    }));
    const result = makeResult([{ name: "day", type: "date" }, ...columns], [{ day: "2026-01-01" }]);
    const data = transformForChart(result, {});
    assert.equal(data.series.length, 8);
    assert.deepEqual(data.droppedSeries, ["m8", "m9"]);
  });

  it("falls back to row numbers when there is no dimension", () => {
    const result = makeResult([{ name: "total", type: "number" }], [{ total: 5 }, { total: 6 }]);
    const data = transformForChart(result, {});
    assert.equal(data.points[0]?.category, "1");
    assert.equal(data.points[1]?.category, "2");
  });

  it("refuses to plot nothing", () => {
    const result = makeResult([{ name: "plan", type: "string" }], [{ plan: "growth" }]);
    assert.throws(() => transformForChart(result, {}), TransformError);
  });
});

describe("transformForShare", () => {
  const byPlan = makeResult(
    [
      { name: "plan", type: "string" },
      { name: "revenue", type: "number" },
    ],
    [
      { plan: "enterprise", revenue: 600 },
      { plan: "growth", revenue: 300 },
      { plan: "starter", revenue: 100 },
    ],
  );

  it("computes percentages that sum to 100", () => {
    const data = transformForShare(byPlan, {});
    assert.equal(data.total, 1000);
    assert.deepEqual(
      data.segments.map((segment) => segment.percent),
      [60, 30, 10],
    );
  });

  it("orders segments largest first", () => {
    const data = transformForShare(byPlan, {});
    assert.deepEqual(
      data.segments.map((segment) => segment.label),
      ["enterprise", "growth", "starter"],
    );
  });

  it("sums duplicate categories rather than showing them twice", () => {
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "revenue", type: "number" },
      ],
      [
        { plan: "growth", revenue: 100 },
        { plan: "growth", revenue: 200 },
      ],
    );
    const data = transformForShare(result, {});
    assert.equal(data.segments.length, 1);
    assert.equal(data.segments[0]?.value, 300);
  });

  it("folds the tail into Other so the segment count stays readable", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      plan: `plan-${i}`,
      revenue: 100 - i,
    }));
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "revenue", type: "number" },
      ],
      rows,
    );
    const data = transformForShare(result, {});
    assert.equal(data.segments.length, MAX_SHARE_SEGMENTS + 1);
    assert.equal(data.folded, true);
    const last = data.segments.at(-1);
    assert.equal(last?.label, OTHER_LABEL);
    assert.equal(last?.color, "var(--color-series-other)");
    // The folded bucket must carry the sum of the tail, not drop it.
    assert.equal(
      data.total,
      rows.reduce((sum, row) => sum + row.revenue, 0),
    );
  });

  it("refuses negative values, which cannot be parts of a whole", () => {
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "revenue", type: "number" },
      ],
      [{ plan: "refunds", revenue: -50 }],
    );
    assert.throws(() => transformForShare(result, {}), TransformError);
  });

  it("does not divide by zero when every value is zero", () => {
    const result = makeResult(
      [
        { name: "plan", type: "string" },
        { name: "revenue", type: "number" },
      ],
      [{ plan: "growth", revenue: 0 }],
    );
    const data = transformForShare(result, {});
    assert.equal(data.segments[0]?.percent, 0);
  });

  it("requires both a breakdown column and a measure", () => {
    const noDimension = makeResult([{ name: "revenue", type: "number" }], [{ revenue: 1 }]);
    assert.throws(() => transformForShare(noDimension, {}), TransformError);

    const noMeasure = makeResult([{ name: "plan", type: "string" }], [{ plan: "growth" }]);
    assert.throws(() => transformForShare(noMeasure, {}), TransformError);
  });
});

describe("transformForKpi", () => {
  it("reads the first measure of the first row", () => {
    assert.deepEqual(transformForKpi(monthly, { measures: ["mrr"] }), {
      value: 1000,
      label: "mrr",
    });
  });

  it("returns null for an empty result rather than throwing", () => {
    const empty = makeResult([{ name: "mrr", type: "number" }], []);
    assert.deepEqual(transformForKpi(empty, {}), { value: null, label: "mrr" });
  });

  it("requires a numeric column", () => {
    const result = makeResult([{ name: "plan", type: "string" }], [{ plan: "growth" }]);
    assert.throws(() => transformForKpi(result, {}), TransformError);
  });
});
