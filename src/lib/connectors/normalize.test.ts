import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyRowLimit, normalizeRows, normalizeValue } from "./normalize.ts";
import type { QueryColumn } from "./types.ts";

describe("normalizeValue", () => {
  it("passes through null and undefined as null", () => {
    assert.equal(normalizeValue(null, "string"), null);
    assert.equal(normalizeValue(undefined, "string"), null);
  });

  it("renders dates as ISO strings so they survive JSON", () => {
    assert.equal(normalizeValue(new Date("2026-01-15T10:30:00Z"), "date"), "2026-01-15T10:30:00.000Z");
    assert.equal(normalizeValue(new Date("nope"), "date"), null);
  });

  it("coerces numeric strings on numeric columns, which is how pg returns bigint", () => {
    assert.equal(normalizeValue("129900", "number"), 129900);
    assert.equal(normalizeValue("-4.5", "number"), -4.5);
    assert.equal(normalizeValue(" 42 ", "number"), 42);
  });

  it("keeps text that would lose precision or is not a number", () => {
    // 20 significant digits: a double cannot represent this exactly.
    assert.equal(normalizeValue("12345678901234567890", "number"), "12345678901234567890");
    assert.equal(normalizeValue("1.10", "number"), "1.10", "trailing zero would be lost");
    assert.equal(normalizeValue("not a number", "number"), "not a number");
    assert.equal(normalizeValue("", "number"), "");
  });

  it("leaves numeric-looking strings alone on non-numeric columns", () => {
    assert.equal(normalizeValue("00123", "string"), "00123");
  });

  it("converts safe bigints to numbers and keeps unsafe ones as text", () => {
    assert.equal(normalizeValue(42n, "number"), 42);
    assert.equal(normalizeValue(9007199254740993n, "number"), "9007199254740993");
  });

  it("drops non-finite numbers rather than emitting invalid JSON", () => {
    assert.equal(normalizeValue(Number.NaN, "number"), null);
    assert.equal(normalizeValue(Number.POSITIVE_INFINITY, "number"), null);
    assert.equal(normalizeValue(0, "number"), 0, "zero must survive");
  });

  it("hex-encodes binary values", () => {
    assert.equal(normalizeValue(new Uint8Array([0xde, 0xad]), "unknown"), "\\xdead");
  });

  it("serializes json and array columns to text", () => {
    assert.equal(normalizeValue({ a: 1 }, "unknown"), '{"a":1}');
    assert.equal(normalizeValue([1, 2], "unknown"), "[1,2]");
  });

  it("survives a value that cannot be serialized", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    assert.equal(typeof normalizeValue(circular, "unknown"), "string");
  });

  it("passes booleans through", () => {
    assert.equal(normalizeValue(true, "boolean"), true);
    assert.equal(normalizeValue(false, "boolean"), false);
  });
});

describe("normalizeRows", () => {
  const columns: QueryColumn[] = [
    { name: "month", type: "date" },
    { name: "mrr_cents", type: "number" },
    { name: "plan", type: "string" },
  ];

  it("normalizes each column according to its declared type", () => {
    const rows = normalizeRows(
      [{ month: new Date("2026-03-01T00:00:00Z"), mrr_cents: "24900", plan: "growth" }],
      columns,
    );
    assert.deepEqual(rows, [
      { month: "2026-03-01T00:00:00.000Z", mrr_cents: 24900, plan: "growth" },
    ]);
  });

  it("keeps columns that the declared schema does not mention", () => {
    const rows = normalizeRows([{ month: null, extra: "kept" }], columns);
    assert.deepEqual(rows, [{ month: null, extra: "kept" }]);
  });
});

describe("applyRowLimit", () => {
  it("flags truncation when the extra probe row came back", () => {
    const result = applyRowLimit([1, 2, 3, 4], 3);
    assert.deepEqual(result.rows, [1, 2, 3]);
    assert.equal(result.truncated, true);
  });

  it("does not flag a result that exactly fills the cap", () => {
    const result = applyRowLimit([1, 2, 3], 3);
    assert.deepEqual(result.rows, [1, 2, 3]);
    assert.equal(result.truncated, false);
  });

  it("handles an empty result", () => {
    assert.deepEqual(applyRowLimit([], 10), { rows: [], truncated: false });
  });
});
