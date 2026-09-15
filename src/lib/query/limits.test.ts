import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  getPublicCacheTtlSeconds,
  getPublicRateLimitPerMinute,
  getQueryLimits,
  parsePositiveInt,
} from "./limits.ts";

describe("parsePositiveInt", () => {
  it("accepts a valid value", () => {
    assert.equal(parsePositiveInt("250", 10, 1000), 250);
  });

  it("falls back for anything that is not a positive integer", () => {
    for (const raw of [undefined, "", "   ", "abc", "0", "-5", "1.5", "NaN", "Infinity"]) {
      assert.equal(parsePositiveInt(raw, 42, 1000), 42, `input: ${String(raw)}`);
    }
  });

  it("clamps to the maximum rather than trusting the environment", () => {
    assert.equal(parsePositiveInt("999999", 10, 1000), 1000);
  });
});

describe("getQueryLimits", () => {
  it("uses safe defaults when unset", () => {
    assert.deepEqual(getQueryLimits({}), { timeoutMs: 15_000, rowLimit: 5_000 });
  });

  it("reads overrides from the environment", () => {
    assert.deepEqual(getQueryLimits({ QUERY_TIMEOUT_MS: "5000", QUERY_ROW_LIMIT: "100" }), {
      timeoutMs: 5_000,
      rowLimit: 100,
    });
  });

  it("never yields an unbounded limit from a bad value", () => {
    const limits = getQueryLimits({ QUERY_TIMEOUT_MS: "0", QUERY_ROW_LIMIT: "-1" });
    assert.ok(limits.timeoutMs > 0);
    assert.ok(limits.rowLimit > 0);
  });
});

describe("public limits", () => {
  it("keeps a cache floor so a public link cannot be used to hammer the database", () => {
    assert.equal(getPublicCacheTtlSeconds({}), 60);
    assert.equal(getPublicCacheTtlSeconds({ PUBLIC_CACHE_TTL_SECONDS: "0" }), 60);
    assert.equal(getPublicCacheTtlSeconds({ PUBLIC_CACHE_TTL_SECONDS: "5" }), 5);
  });

  it("defaults the rate limit", () => {
    assert.equal(getPublicRateLimitPerMinute({}), 60);
    assert.equal(getPublicRateLimitPerMinute({ PUBLIC_RATE_LIMIT_PER_MINUTE: "10" }), 10);
  });
});
