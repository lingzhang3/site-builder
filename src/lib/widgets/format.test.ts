import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAxisTick, formatCategory, formatNumber, formatValue } from "./format";

describe("formatNumber", () => {
  it("formats plain numbers without inventing precision", () => {
    assert.equal(formatNumber(1234.5, { style: "plain" }), "1,234.5");
    assert.equal(formatNumber(1000, { style: "plain" }), "1,000");
  });

  it("formats currency with no stray decimals by default", () => {
    assert.equal(formatNumber(1299, { style: "currency", currency: "USD" }), "$1,299");
    assert.equal(
      formatNumber(1299.5, { style: "currency", currency: "USD", decimals: 2 }),
      "$1,299.50",
    );
  });

  it("formats percentages as already-scaled values", () => {
    // 42 means 42%, which is what a `x * 100.0 / total` query returns.
    assert.equal(formatNumber(42, { style: "percent" }), "42.0%");
    assert.equal(formatNumber(42.456, { style: "percent", decimals: 1 }), "42.5%");
  });

  it("compacts large numbers", () => {
    assert.equal(formatNumber(1_200_000, { style: "compact" }), "1.2M");
    assert.equal(formatNumber(12_900, { style: "compact" }), "12.9K");
  });

  it("never renders a non-finite number as NaN or Infinity", () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      assert.equal(formatNumber(value, { style: "compact" }), "—");
    }
  });

  it("does not leak floating point noise", () => {
    assert.equal(formatNumber(0.1 + 0.2, { style: "plain" }), "0.3");
  });
});

describe("formatValue", () => {
  it("renders null and undefined as an em dash, not as text", () => {
    assert.equal(formatValue(null), "—");
    assert.equal(formatValue(undefined), "—");
  });

  it("formats numeric strings, since pg returns bigint as text", () => {
    assert.equal(formatValue("1200000", { style: "compact" }), "1.2M");
  });

  it("passes non-numeric strings through as labels", () => {
    assert.equal(formatValue("enterprise", { style: "compact" }), "enterprise");
    assert.equal(formatValue("", { style: "compact" }), "");
  });

  it("renders booleans readably", () => {
    assert.equal(formatValue(true), "true");
    assert.equal(formatValue(false), "false");
  });
});

describe("formatAxisTick", () => {
  it("keeps ticks short", () => {
    assert.equal(formatAxisTick(1_200_000), "1.2M");
    assert.equal(formatAxisTick(0), "0");
  });

  it("renders nothing for a non-finite tick rather than NaN", () => {
    assert.equal(formatAxisTick(Number.NaN), "");
  });
});

describe("formatCategory", () => {
  it("shortens a month bucket from date_trunc", () => {
    assert.equal(formatCategory("2026-03-01T00:00:00.000Z"), "2026-03");
  });

  it("keeps a day-level date as a date", () => {
    assert.equal(formatCategory("2026-03-15T12:30:00.000Z"), "2026-03-15");
    assert.equal(formatCategory("2026-03-15"), "2026-03-15");
  });

  it("passes ordinary labels through", () => {
    assert.equal(formatCategory("enterprise"), "enterprise");
    assert.equal(formatCategory(42), "42");
    assert.equal(formatCategory(null), "—");
  });
});
