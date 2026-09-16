import { count, eq } from "drizzle-orm";

import { AddConnectionButton } from "@/components/connections/connection-form";
import { ConnectionRowActions } from "@/components/connections/connection-row-actions";
import { Badge, Card, EmptyState } from "@/components/ui";
import { db } from "@/db";
import { connections, datasets } from "@/db/schema";
import { CONNECTION_TYPE_LABELS } from "@/lib/connectors";
import { canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function ConnectionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);

  // Selecting explicit columns, not the whole row: `encryptedConfig` must not
  // travel into a server component's props, where it would be serialized into
  // the page payload.
  const rows = await db
    .select({
      id: connections.id,
      name: connections.name,
      type: connections.type,
      host: connections.displayHost,
      port: connections.displayPort,
      database: connections.displayDatabase,
      user: connections.displayUser,
      lastTestedAt: connections.lastTestedAt,
      lastTestError: connections.lastTestError,
      credentialsCanWrite: connections.credentialsCanWrite,
      datasetCount: count(datasets.id),
    })
    .from(connections)
    .leftJoin(datasets, eq(datasets.connectionId, connections.id))
    .where(eq(connections.orgId, org.id))
    .groupBy(connections.id)
    .orderBy(connections.name);

  const editable = canEdit(role);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Connections</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Read-only links to the databases behind your SaaS tools.
          </p>
        </div>
        {/* The one place this action lives. Keeping it out of the empty state
            below is deliberate: that subtree is unmounted the moment the first
            connection is saved, which would tear down the open modal and the
            success message inside it. */}
        {editable ? <AddConnectionButton orgSlug={orgSlug} /> : null}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No connections yet"
          description={
            editable
              ? "Use “Add connection” above. We connect read-only, so give us a database user that cannot modify data."
              : "An editor on your team can connect a database."
          }
        />
      ) : (
        <div className="space-y-3">
          {rows.map((row) => (
            <Card key={row.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-medium text-ink">{row.name}</h2>
                    <Badge>{CONNECTION_TYPE_LABELS[row.type]}</Badge>
                    {row.lastTestError ? (
                      <Badge tone="danger">Failing</Badge>
                    ) : row.lastTestedAt ? (
                      <Badge tone="success">Connected</Badge>
                    ) : null}
                    {row.credentialsCanWrite ? <Badge tone="warning">Can write</Badge> : null}
                  </div>

                  <p className="mt-1 truncate font-mono text-xs text-ink-subtle">
                    {row.user}@{row.host}:{row.port}/{row.database}
                  </p>

                  <p className="mt-1 text-xs text-ink-subtle">
                    {row.datasetCount} dataset{row.datasetCount === 1 ? "" : "s"}
                    {row.lastTestedAt
                      ? ` · last tested ${row.lastTestedAt.toLocaleString()}`
                      : " · never tested"}
                  </p>

                  {row.lastTestError ? (
                    <p className="mt-2 text-xs text-danger">{row.lastTestError}</p>
                  ) : null}
                </div>

                {editable ? (
                  <ConnectionRowActions
                    orgSlug={orgSlug}
                    connectionId={row.id}
                    connectionName={row.name}
                    datasetCount={Number(row.datasetCount)}
                  />
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
