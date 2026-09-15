import Link from "next/link";
import { eq } from "drizzle-orm";

import { Badge, Button, Card, EmptyState } from "@/components/ui";
import { db } from "@/db";
import { connections, datasets } from "@/db/schema";
import { canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function DatasetsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);

  const rows = await db
    .select({
      id: datasets.id,
      name: datasets.name,
      lastRunAt: datasets.lastRunAt,
      resultSchema: datasets.resultSchema,
      connectionName: connections.name,
      connectionType: connections.type,
    })
    .from(datasets)
    .innerJoin(connections, eq(connections.id, datasets.connectionId))
    .where(eq(datasets.orgId, org.id))
    .orderBy(datasets.name);

  const [hasConnection] = await db
    .select({ id: connections.id })
    .from(connections)
    .where(eq(connections.orgId, org.id))
    .limit(1);

  const editable = canEdit(role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Datasets</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Saved read-only queries. Widgets bind to these, not to raw tables.
          </p>
        </div>
        {editable && hasConnection ? (
          <Link href={`/${orgSlug}/datasets/new`}>
            <Button variant="primary">New dataset</Button>
          </Link>
        ) : null}
      </div>

      {!hasConnection ? (
        <EmptyState
          title="Connect a database first"
          description="A dataset is a query against one of your connections, so there is nothing to query yet."
          action={
            editable ? (
              <Link href={`/${orgSlug}/connections`}>
                <Button variant="primary">Go to connections</Button>
              </Link>
            ) : undefined
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No datasets yet"
          description="Write a query once, then reuse it across as many widgets as you like."
          action={
            editable ? (
              <Link href={`/${orgSlug}/datasets/new`}>
                <Button variant="primary">New dataset</Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((row) => (
            <Link key={row.id} href={`/${orgSlug}/datasets/${row.id}`} className="group">
              <Card className="h-full p-4 transition-colors group-hover:border-border-strong">
                <h2 className="truncate text-sm font-medium text-ink">{row.name}</h2>
                <p className="mt-1 truncate text-xs text-ink-subtle">{row.connectionName}</p>

                <div className="mt-3 flex flex-wrap gap-1">
                  {(row.resultSchema ?? []).slice(0, 4).map((column) => (
                    <Badge key={column.name}>{column.name}</Badge>
                  ))}
                  {(row.resultSchema ?? []).length > 4 ? (
                    <Badge>+{(row.resultSchema ?? []).length - 4}</Badge>
                  ) : null}
                  {(row.resultSchema ?? []).length === 0 ? (
                    <span className="text-xs text-ink-subtle">Never run</span>
                  ) : null}
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
