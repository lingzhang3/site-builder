import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_CURRENCY, isSupportedCurrency, safeCurrency } from "./currency";

describe("isSupportedCurrency", () => {
  it("accepts real codes", () => {
    for (const code of ["USD", "EUR", "JPY", "CNY", "GBP", "BRL"]) {
      assert.equal(isSupportedCurrency(code), true, code);
    }
  });

  it("rejects codes Intl throws on, without throwing itself", () => {
    for (const code of ["NOPE", "", "US", "USDD", "123", "  ", "$$$"]) {
      assert.equal(isSupportedCurrency(code), false, JSON.stringify(code));
    }
  });

  it("rejects non-string input defensively, since configs come from JSON", () => {
    for (const value of [null, undefined, 42, {}, []]) {
      assert.equal(isSupportedCurrency(value as unknown as string), false, String(value));
    }
  });
});

describe("safeCurrency", () => {
  it("passes a valid code through, upper-cased", () => {
    assert.equal(safeCurrency("eur"), "EUR");
    assert.equal(safeCurrency("JPY"), "JPY");
  });

  it("falls back rather than letting a bad code reach Intl", () => {
    for (const code of [undefined, "", "NOPE", "USDD"]) {
      assert.equal(safeCurrency(code), DEFAULT_CURRENCY, String(code));
    }
  });
});
