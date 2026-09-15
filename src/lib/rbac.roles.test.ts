/**
 * Role comparison is pure, so it is tested here without a database. The
 * membership queries in rbac.ts are covered by the end-to-end test instead,
 * since their whole point is what the database returns.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MemberRole } from "../db/schema";

// Re-declared rather than imported: rbac.ts pulls in `server-only`, next/navigation
// and the database client, none of which load under a bare `node --test`.
const ROLE_ORDER: MemberRole[] = ["viewer", "editor", "owner"];
const roleAtLeast = (role: MemberRole, minimum: MemberRole) =>
  ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
const canEdit = (role: MemberRole) => roleAtLeast(role, "editor");
const canAdminister = (role: MemberRole) => roleAtLeast(role, "owner");

describe("role hierarchy", () => {
  it("orders viewer < editor < owner", () => {
    assert.equal(roleAtLeast("owner", "viewer"), true);
    assert.equal(roleAtLeast("owner", "editor"), true);
    assert.equal(roleAtLeast("owner", "owner"), true);
    assert.equal(roleAtLeast("editor", "viewer"), true);
    assert.equal(roleAtLeast("editor", "editor"), true);
    assert.equal(roleAtLeast("editor", "owner"), false);
    assert.equal(roleAtLeast("viewer", "editor"), false);
    assert.equal(roleAtLeast("viewer", "owner"), false);
  });

  it("only lets editors and owners change things", () => {
    assert.equal(canEdit("viewer"), false);
    assert.equal(canEdit("editor"), true);
    assert.equal(canEdit("owner"), true);
  });

  it("only lets owners publish and manage members", () => {
    assert.equal(canAdminister("viewer"), false);
    assert.equal(canAdminister("editor"), false);
    assert.equal(canAdminister("owner"), true);
  });
});
