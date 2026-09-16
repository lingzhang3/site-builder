"use server";

import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath, revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import {
  connections,
  dashboards,
  datasets,
  publications,
  widgets,
  type WidgetType,
} from "@/db/schema";
import type { QueryResult } from "@/lib/connectors/types";
import { runQuery } from "@/lib/query/execute";
import { generateShareToken } from "@/lib/crypto";
import {
  ForbiddenError,
  requireEditorBySlug,
  requireOrgBySlug,
  requireOwnerBySlug,
} from "@/lib/rbac";
import { dedupeSlug, toSafeSlug } from "@/lib/slug";
import type { DashboardLayout } from "@/lib/dashboards/types";
import { widgetConfigSchema } from "@/lib/widgets/config-schema";
import { defaultConfigFor, isDataWidget, type WidgetConfig } from "@/lib/widgets/types";

export interface DashboardFormState {
  error?: string;
}

/* -------------------------------------------------------------------------- */
/* Dashboards                                                                 */
/* -------------------------------------------------------------------------- */

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the dashboard.").max(120),
});

export async function createDashboardAction(
  orgSlug: string,
  _prev: DashboardFormState,
  formData: FormData,
): Promise<DashboardFormState> {
  let org;
  try {
    ({ org } = await requireEditorBySlug(orgSlug));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const parsed = createSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const desired = toSafeSlug(parsed.data.name);
  const existing = await db
    .select({ slug: dashboards.slug })
    .from(dashboards)
    .where(eq(dashboards.orgId, org.id));

  const [dashboard] = await db
    .insert(dashboards)
    .values({
      orgId: org.id,
      name: parsed.data.name,
      // Slugs are unique per organization, so only this org's slugs can collide.
      slug: dedupeSlug(desired, new Set(existing.map((row) => row.slug))),
      layout: { lg: [] },
    })
    .returning({ id: dashboards.id });

  if (!dashboard) return { error: "Could not create the dashboard." };

  revalidatePath(`/${orgSlug}/dashboards`);
  redirect(`/${orgSlug}/dashboards/${dashboard.id}/edit`);
}

export async function renameDashboardAction(
  orgSlug: string,
  dashboardId: string,
  name: string,
): Promise<DashboardFormState> {
  const { org } = await requireEditorBySlug(orgSlug);
  const trimmed = name.trim();
  if (trimmed.length === 0) return { error: "Name the dashboard." };

  await db
    .update(dashboards)
    .set({ name: trimmed, updatedAt: new Date() })
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, org.id)));

  revalidatePath(`/${orgSlug}/dashboards`);
  return {};
}

export async function deleteDashboardAction(orgSlug: string, dashboardId: string): Promise<void> {
  const { org } = await requireEditorBySlug(orgSlug);

  await db
    .delete(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, org.id)));

  revalidatePath(`/${orgSlug}/dashboards`);
  redirect(`/${orgSlug}/dashboards`);
}

/* -------------------------------------------------------------------------- */
/* Widgets                                                                    */
/* -------------------------------------------------------------------------- */

/** Confirms the dashboard belongs to an org the caller may edit. */
async function requireOwnedDashboard(orgSlug: string, dashboardId: string) {
  const { org } = await requireEditorBySlug(orgSlug);
  const [dashboard] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, org.id)))
    .limit(1);
  return dashboard ? { orgId: org.id, dashboardId: dashboard.id } : null;
}

export async function addWidgetAction(
  orgSlug: string,
  dashboardId: string,
  type: WidgetType,
): Promise<{ error?: string; widgetId?: string }> {
  const owned = await requireOwnedDashboard(orgSlug, dashboardId);
  if (!owned) return { error: "That dashboard no longer exists." };

  const [widget] = await db
    .insert(widgets)
    .values({
      dashboardId: owned.dashboardId,
      type,
      title: "",
      config: defaultConfigFor(type),
    })
    .returning({ id: widgets.id });

  if (!widget) return { error: "Could not add the widget." };

  revalidatePath(`/${orgSlug}/dashboards/${dashboardId}/edit`);
  return { widgetId: widget.id };
}

const updateWidgetSchema = z.object({
  title: z.string().max(200),
  datasetId: z.string().uuid().nullable(),
  // A real schema, not z.custom: this value is attacker-controlled, is stored
  // as jsonb, and is read back and rendered — including on a published page
  // served to anonymous visitors. See config-schema.ts.
  config: widgetConfigSchema,
});

export async function updateWidgetAction(
  orgSlug: string,
  dashboardId: string,
  widgetId: string,
  input: { title: string; datasetId: string | null; config: WidgetConfig },
): Promise<{ error?: string }> {
  const owned = await requireOwnedDashboard(orgSlug, dashboardId);
  if (!owned) return { error: "That dashboard no longer exists." };

  const parsed = updateWidgetSchema.safeParse(input);
  if (!parsed.success) return { error: "Those widget settings are not valid." };

  // The dataset must belong to the same org, or a widget could be pointed at
  // another tenant's data by passing its id.
  if (parsed.data.datasetId) {
    const [dataset] = await db
      .select({ id: datasets.id })
      .from(datasets)
      .where(and(eq(datasets.id, parsed.data.datasetId), eq(datasets.orgId, owned.orgId)))
      .limit(1);
    if (!dataset) return { error: "That dataset no longer exists." };
  }

  await db
    .update(widgets)
    .set({
      title: parsed.data.title,
      datasetId: parsed.data.datasetId,
      config: parsed.data.config,
    })
    .where(and(eq(widgets.id, widgetId), eq(widgets.dashboardId, owned.dashboardId)));

  revalidatePath(`/${orgSlug}/dashboards/${dashboardId}/edit`);
  return {};
}

export async function deleteWidgetAction(
  orgSlug: string,
  dashboardId: string,
  widgetId: string,
): Promise<{ error?: string }> {
  const owned = await requireOwnedDashboard(orgSlug, dashboardId);
  if (!owned) return { error: "That dashboard no longer exists." };

  await db
    .delete(widgets)
    .where(and(eq(widgets.id, widgetId), eq(widgets.dashboardId, owned.dashboardId)));

  revalidatePath(`/${orgSlug}/dashboards/${dashboardId}/edit`);
  return {};
}

const layoutSchema = z.record(
  z.enum(["lg", "md", "sm"]),
  z.array(
    z.object({
      i: z.string(),
      x: z.number().int().min(0),
      y: z.number().int().min(0),
      w: z.number().int().min(1),
      h: z.number().int().min(1),
    }),
  ),
);

/** Called on every drag/resize settle, so it stays small and does no queries. */
export async function saveLayoutAction(
  orgSlug: string,
  dashboardId: string,
  layout: DashboardLayout,
): Promise<{ error?: string }> {
  const owned = await requireOwnedDashboard(orgSlug, dashboardId);
  if (!owned) return { error: "That dashboard no longer exists." };

  const parsed = layoutSchema.safeParse(layout);
  if (!parsed.success) return { error: "That layout is not valid." };

  await db
    .update(dashboards)
    .set({ layout: parsed.data as DashboardLayout, updatedAt: new Date() })
    .where(eq(dashboards.id, owned.dashboardId));

  return {};
}

/* -------------------------------------------------------------------------- */
/* Widget data                                                                */
/* -------------------------------------------------------------------------- */

export interface WidgetData {
  result?: QueryResult;
  error?: string;
}

/**
 * Runs every widget's dataset in one round trip. The queries go to the
 * customer's database in parallel, but each still passes through `runQuery`,
 * so the read-only guard, timeout, row cap and audit record all apply.
 */
export async function loadDashboardDataAction(
  orgSlug: string,
  dashboardId: string,
): Promise<Record<string, WidgetData>> {
  const { org } = await requireOrgBySlug(orgSlug);

  const [dashboard] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, org.id)))
    .limit(1);
  if (!dashboard) return {};

  const rows = await db
    .select({
      widgetId: widgets.id,
      type: widgets.type,
      datasetId: datasets.id,
      sql: datasets.sql,
      connection: connections,
    })
    .from(widgets)
    .leftJoin(datasets, eq(datasets.id, widgets.datasetId))
    .leftJoin(connections, eq(connections.id, datasets.connectionId))
    .where(eq(widgets.dashboardId, dashboard.id));

  const results: Record<string, WidgetData> = {};

  await Promise.all(
    rows.map(async (row) => {
      if (!isDataWidget(row.type)) return;
      if (!row.datasetId || !row.sql || !row.connection) {
        results[row.widgetId] = { error: "No dataset selected." };
        return;
      }

      const outcome = await runQuery({
        orgId: org.id,
        connection: row.connection,
        sql: row.sql,
        datasetId: row.datasetId,
      });

      results[row.widgetId] = outcome.ok
        ? { result: outcome.result }
        : { error: outcome.error };
    }),
  );

  return results;
}

/* -------------------------------------------------------------------------- */
/* Publishing                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Creates a share link. Only owners can publish: the link lets anyone who has
 * it read query results from the organization's connected databases, which is
 * an access-granting decision, not an editing one.
 *
 * Publishing twice reuses the live publication rather than minting a second
 * token, so "the link" for a dashboard stays a single thing you can revoke.
 */
export async function publishDashboardAction(
  orgSlug: string,
  dashboardId: string,
): Promise<{ error?: string; token?: string }> {
  let context;
  try {
    context = await requireOwnerBySlug(orgSlug);
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const [dashboard] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, context.org.id)))
    .limit(1);
  if (!dashboard) return { error: "That dashboard no longer exists." };

  const [existing] = await db
    .select({ token: publications.token })
    .from(publications)
    .where(and(eq(publications.dashboardId, dashboard.id), isNull(publications.revokedAt)))
    .limit(1);

  if (existing) return { token: existing.token };

  const [publication] = await db
    .insert(publications)
    .values({
      dashboardId: dashboard.id,
      token: generateShareToken(),
      createdBy: context.userId,
    })
    .returning({ token: publications.token });

  if (!publication) return { error: "Could not create the link." };

  revalidatePath(`/${orgSlug}/dashboards`);
  return { token: publication.token };
}

/** Revokes every live link for the dashboard, breaking the URL immediately. */
export async function revokePublicationAction(
  orgSlug: string,
  dashboardId: string,
): Promise<{ error?: string }> {
  let context;
  try {
    context = await requireOwnerBySlug(orgSlug);
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const [dashboard] = await db
    .select({ id: dashboards.id })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, context.org.id)))
    .limit(1);
  if (!dashboard) return { error: "That dashboard no longer exists." };

  const revoked = await db
    .update(publications)
    .set({ revokedAt: new Date() })
    .where(and(eq(publications.dashboardId, dashboard.id), isNull(publications.revokedAt)))
    .returning({ id: publications.id });

  // Drop the cached widget data so a revoked link cannot keep serving from
  // cache until its TTL happens to expire.
  for (const publication of revoked) {
    revalidateTag(`publication:${publication.id}`);
  }

  revalidatePath(`/${orgSlug}/dashboards`);
  return {};
}
