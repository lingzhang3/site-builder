import "server-only";

import { eq, inArray } from "drizzle-orm";

import { db } from "@/db";
import { memberships, organizations, type Organization } from "@/db/schema";
import { dedupeSlug, toSafeSlug } from "./slug";

/**
 * Creates an organization and makes `userId` its owner, in one transaction so
 * an organization can never exist without a member who can administer it.
 */
export async function createOrgForUser(
  userId: string,
  name: string,
): Promise<Organization> {
  const desired = toSafeSlug(name);

  return db.transaction(async (tx) => {
    // Only check the slugs that could actually collide, rather than reading
    // every organization in the system.
    const candidates = [desired, ...Array.from({ length: 20 }, (_, i) => `${desired}-${i + 2}`)];
    const existing = await tx
      .select({ slug: organizations.slug })
      .from(organizations)
      .where(inArray(organizations.slug, candidates));

    const slug = dedupeSlug(desired, new Set(existing.map((row) => row.slug)));

    const [org] = await tx
      .insert(organizations)
      .values({ name: name.trim() || slug, slug })
      .returning();

    if (!org) throw new Error("Failed to create organization.");

    await tx.insert(memberships).values({ userId, orgId: org.id, role: "owner" });
    return org;
  });
}

/** The org to land on after sign-in. */
export async function firstOrgForUser(userId: string): Promise<Organization | null> {
  const rows = await db
    .select({ org: organizations })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.orgId))
    .where(eq(memberships.userId, userId))
    .orderBy(organizations.createdAt)
    .limit(1);

  return rows[0]?.org ?? null;
}
