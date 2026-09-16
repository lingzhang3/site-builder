import Link from "next/link";
import { desc, eq, isNull, and } from "drizzle-orm";

import { NewDashboardForm } from "@/components/dashboards/new-dashboard-form";
import { Badge, Card, EmptyState } from "@/components/ui";
import { db } from "@/db";
import { dashboards, publications } from "@/db/schema";
import { canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function DashboardsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);

  const rows = await db
    .select({
      id: dashboards.id,
      name: dashboards.name,
      updatedAt: dashboards.updatedAt,
      publishedToken: publications.token,
    })
    .from(dashboards)
    .leftJoin(
      publications,
      and(eq(publications.dashboardId, dashboards.id), isNull(publications.revokedAt)),
    )
    .where(eq(dashboards.orgId, org.id))
    .orderBy(desc(dashboards.updatedAt));

  const editable = canEdit(role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Dashboards</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Arrange widgets on a grid, then share a read-only link.
          </p>
        </div>
        {/* Kept out of the empty state below, whose subtree is unmounted as
            soon as the first dashboard exists. */}
        {editable ? <NewDashboardForm orgSlug={orgSlug} /> : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No dashboards yet"
          description={
            editable
              ? "Use “New dashboard” above, then drop in widgets and point them at your datasets."
              : "An editor on your team can create one."
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/${orgSlug}/dashboards/${row.id}/edit`} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-border-strong">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="truncate text-sm font-medium text-ink">{row.name}</h2>
                  {row.publishedToken ? <Badge tone="success">Published</Badge> : null}
                </div>
                <p className="mt-1 text-xs text-ink-subtle">
                  Updated {row.updatedAt.toLocaleString()}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
