/**
 * These exercise the zod schema, so they need dependencies installed and run
 * under `pnpm test` / CI rather than on a bare checkout. The crash this schema
 * exists to prevent is additionally covered, dependency-free, in
 * currency.test.ts and format.test.ts.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { widgetConfigSchema } from "./config-schema";

describe("widgetConfigSchema", () => {
  it("accepts a realistic config", () => {
    const result = widgetConfigSchema.safeParse({
      dimension: "month",
      measures: ["revenue", "new_revenue"],
      format: { style: "currency", currency: "USD", decimals: 2 },
      showLegend: true,
      stacked: false,
    });
    assert.equal(result.success, true);
  });

  it("accepts an empty config", () => {
    assert.equal(widgetConfigSchema.safeParse({}).success, true);
  });

  it("strips unknown keys rather than storing them", () => {
    const result = widgetConfigSchema.safeParse({ dimension: "month", nonsense: "dropped" });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.deepEqual(Object.keys(result.data), ["dimension"]);
  });

  it("rejects a currency code Intl would throw on", () => {
    // This is the one that matters: an unchecked value here becomes a
    // RangeError at render time, taking the widget and its page down.
    for (const currency of ["NOPE", "US", "USDD", "", "123"]) {
      const result = widgetConfigSchema.safeParse({ style: "currency", format: { style: "currency", currency } });
      assert.equal(result.success, false, `should reject currency ${JSON.stringify(currency)}`);
    }
  });

  it("normalizes a lowercase currency code", () => {
    const result = widgetConfigSchema.safeParse({ format: { style: "currency", currency: "eur" } });
    assert.equal(result.success, true);
    if (!result.success) return;
    assert.equal(result.data.format?.currency, "EUR");
  });

  it("rejects an unknown format style", () => {
    assert.equal(
      widgetConfigSchema.safeParse({ format: { style: "scientific" } }).success,
      false,
    );
  });

  it("rejects decimal counts that are not readable or that Intl refuses", () => {
    for (const decimals of [-1, 7, 21, 1.5, Number.NaN]) {
      assert.equal(
        widgetConfigSchema.safeParse({ format: { style: "plain", decimals } }).success,
        false,
        `should reject decimals ${decimals}`,
      );
    }
  });

  it("bounds the arrays and the text body", () => {
    assert.equal(
      widgetConfigSchema.safeParse({ measures: Array.from({ length: 65 }, (_, i) => `m${i}`) })
        .success,
      false,
    );
    assert.equal(widgetConfigSchema.safeParse({ body: "x".repeat(10_001) }).success, false);
    assert.equal(widgetConfigSchema.safeParse({ body: "x".repeat(10_000) }).success, true);
  });

  it("rejects an empty or oversized column name", () => {
    assert.equal(widgetConfigSchema.safeParse({ dimension: "" }).success, false);
    assert.equal(widgetConfigSchema.safeParse({ measures: [""] }).success, false);
    assert.equal(widgetConfigSchema.safeParse({ dimension: "x".repeat(201) }).success, false);
  });

  it("rejects wrong types instead of coercing them", () => {
    assert.equal(widgetConfigSchema.safeParse({ measures: "revenue" }).success, false);
    assert.equal(widgetConfigSchema.safeParse({ stacked: "yes" }).success, false);
    assert.equal(widgetConfigSchema.safeParse(null).success, false);
    assert.equal(widgetConfigSchema.safeParse("nope").success, false);
  });
});
