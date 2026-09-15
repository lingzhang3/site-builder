import { and, eq, isNull } from "drizzle-orm";
import { notFound } from "next/navigation";

import { DashboardEditor } from "@/components/dashboards/dashboard-editor";
import { db } from "@/db";
import { dashboards, datasets, publications, widgets } from "@/db/schema";
import { canAdminister, canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function EditDashboardPage({
  params,
}: {
  params: Promise<{ orgSlug: string; dashboardId: string }>;
}) {
  const { orgSlug, dashboardId } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);
  if (!canEdit(role)) notFound();

  const [dashboard] = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      layout: dashboards.layout,
    })
    .from(dashboards)
    .where(and(eq(dashboards.id, dashboardId), eq(dashboards.orgId, org.id)))
    .limit(1);

  if (!dashboard) notFound();

  const widgetRows = await db
    .select({
      id: widgets.id,
      type: widgets.type,
      title: widgets.title,
      datasetId: widgets.datasetId,
      config: widgets.config,
    })
    .from(widgets)
    .where(eq(widgets.dashboardId, dashboard.id))
    .orderBy(widgets.createdAt);

  // Column lists come from each dataset's last successful run, so the inspector
  // populates without querying the customer's database.
  const datasetRows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      resultSchema: datasets.resultSchema,
    })
    .from(datasets)
    .where(eq(datasets.orgId, org.id))
    .orderBy(datasets.name);

  const [publication] = await db
    .select({ token: publications.token, createdAt: publications.createdAt })
    .from(publications)
    .where(and(eq(publications.dashboardId, dashboard.id), isNull(publications.revokedAt)))
    .limit(1);

  return (
    <DashboardEditor
      orgSlug={orgSlug}
      dashboard={dashboard}
      initialWidgets={widgetRows.map((widget) => ({
        ...widget,
        config: widget.config ?? {},
      }))}
      datasets={datasetRows.map((dataset) => ({
        id: dataset.id,
        name: dataset.name,
        columns: dataset.resultSchema ?? [],
      }))}
      publication={
        publication
          ? { token: publication.token, createdAt: publication.createdAt.toISOString() }
          : null
      }
      canPublish={canAdminister(role)}
    />
  );
}
