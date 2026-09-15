import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { NewDatasetForm } from "@/components/datasets/new-dataset-form";
import { Card } from "@/components/ui";
import { db } from "@/db";
import { connections } from "@/db/schema";
import { CONNECTION_TYPE_LABELS } from "@/lib/connectors";
import { canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function NewDatasetPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);
  if (!canEdit(role)) notFound();

  const available = await db
    .select({ id: connections.id, name: connections.name, type: connections.type })
    .from(connections)
    .where(eq(connections.orgId, org.id))
    .orderBy(connections.name);

  return (
    <div className="mx-auto max-w-md">
      <Card className="p-6">
        <h1 className="text-lg font-semibold text-ink">New dataset</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Pick a connection; you will write the query next.
        </p>
        <NewDatasetForm
          orgSlug={orgSlug}
          connections={available.map((connection) => ({
            ...connection,
            typeLabel: CONNECTION_TYPE_LABELS[connection.type],
          }))}
        />
      </Card>
    </div>
  );
}
