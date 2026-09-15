import "server-only";

import { and, eq } from "drizzle-orm";
import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { db } from "@/db";
import { memberships, organizations, type MemberRole, type Organization } from "@/db/schema";

/**
 * Every tenant-scoped read and write goes through here.
 *
 * The rule the whole multi-tenant story rests on: a request may only touch
 * rows whose `orgId` the signed-in user is a member of. Server Actions and
 * route handlers are public HTTP endpoints — an id in a form field is
 * attacker-controlled — so membership is re-checked on the server every time,
 * never inferred from the URL or a hidden input.
 */

/** Ordered least to most privileged, so comparisons are just index math. */
const ROLE_ORDER: MemberRole[] = ["viewer", "editor", "owner"];

export function roleAtLeast(role: MemberRole, minimum: MemberRole): boolean {
  return ROLE_ORDER.indexOf(role) >= ROLE_ORDER.indexOf(minimum);
}

/** Can create and change connections, datasets and dashboards. */
export function canEdit(role: MemberRole): boolean {
  return roleAtLeast(role, "editor");
}

/** Can publish, revoke share links, and manage members. */
export function canAdminister(role: MemberRole): boolean {
  return roleAtLeast(role, "owner");
}

export interface OrgContext {
  userId: string;
  org: Organization;
  role: MemberRole;
}

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to do that.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

async function requireUserId(): Promise<string> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) redirect("/login");
  return userId;
}

/**
 * Resolves an org from its slug and asserts membership.
 *
 * Returns `notFound()` rather than a 403 for a slug the user is not a member
 * of: telling them "this org exists but is not yours" would leak which
 * organizations are registered.
 */
export async function requireOrgBySlug(slug: string): Promise<OrgContext> {
  const userId = await requireUserId();

  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(organizations)
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, organizations.id), eq(memberships.userId, userId)),
    )
    .where(eq(organizations.slug, slug))
    .limit(1);

  const found = rows[0];
  if (!found) notFound();

  return { userId, org: found.org, role: found.role };
}

/** Same, by id — for Server Actions that receive an org id from a form. */
export async function requireOrgById(orgId: string): Promise<OrgContext> {
  const userId = await requireUserId();

  const rows = await db
    .select({ org: organizations, role: memberships.role })
    .from(organizations)
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, organizations.id), eq(memberships.userId, userId)),
    )
    .where(eq(organizations.id, orgId))
    .limit(1);

  const found = rows[0];
  if (!found) notFound();

  return { userId, org: found.org, role: found.role };
}

export async function requireEditorBySlug(slug: string): Promise<OrgContext> {
  const context = await requireOrgBySlug(slug);
  if (!canEdit(context.role)) {
    throw new ForbiddenError("You need editor access to change this.");
  }
  return context;
}

export async function requireEditorById(orgId: string): Promise<OrgContext> {
  const context = await requireOrgById(orgId);
  if (!canEdit(context.role)) {
    throw new ForbiddenError("You need editor access to change this.");
  }
  return context;
}

export async function requireOwnerById(orgId: string): Promise<OrgContext> {
  const context = await requireOrgById(orgId);
  if (!canAdminister(context.role)) {
    throw new ForbiddenError("You need owner access to do that.");
  }
  return context;
}

/** Organizations the signed-in user belongs to, for the org switcher. */
export async function listMyOrgs(): Promise<{ org: Organization; role: MemberRole }[]> {
  const userId = await requireUserId();
  return db
    .select({ org: organizations, role: memberships.role })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.name);
}
