import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { dedupeSlug, isReservedSlug, slugify, toSafeSlug } from "./slug";

describe("slugify", () => {
  it("lowercases and hyphenates", () => {
    assert.equal(slugify("Acme Analytics"), "acme-analytics");
    assert.equal(slugify("Q3   Revenue"), "q3-revenue");
  });

  it("strips accents rather than the letters under them", () => {
    assert.equal(slugify("Café Münster"), "cafe-munster");
  });

  it("removes characters that would break routing", () => {
    assert.equal(slugify("../../etc/passwd"), "etc-passwd");
    assert.equal(slugify("a/b?c=d#e"), "a-b-c-d-e");
    assert.equal(slugify("--leading and trailing--"), "leading-and-trailing");
  });

  it("returns empty for input with nothing to keep", () => {
    assert.equal(slugify("你好"), "");
    assert.equal(slugify("!!!"), "");
    assert.equal(slugify(""), "");
  });

  it("truncates without leaving a trailing hyphen", () => {
    const slug = slugify(`${"a".repeat(47)} b`);
    assert.ok(slug.length <= 48);
    assert.ok(!slug.endsWith("-"), slug);
  });
});

describe("toSafeSlug", () => {
  it("keeps a good slug as-is", () => {
    assert.equal(toSafeSlug("Acme Inc", () => "xxxxxx"), "acme-inc");
  });

  it("falls back when the name slugifies to nothing", () => {
    assert.equal(toSafeSlug("你好", () => "abc123"), "org-abc123");
  });

  it("disambiguates names that collide with the app's own routes", () => {
    for (const reserved of ["API", "settings", "p", "login"]) {
      const slug = toSafeSlug(reserved, () => "abc123");
      assert.ok(!isReservedSlug(slug), `${reserved} -> ${slug} is still reserved`);
      assert.match(slug, /-abc123$/);
    }
  });
});

describe("dedupeSlug", () => {
  it("returns the slug when it is free", () => {
    assert.equal(dedupeSlug("acme", new Set()), "acme");
  });

  it("appends the first free counter", () => {
    assert.equal(dedupeSlug("acme", new Set(["acme"])), "acme-2");
    assert.equal(dedupeSlug("acme", new Set(["acme", "acme-2", "acme-3"])), "acme-4");
  });
});
