import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";

import { DatasetEditor } from "@/components/datasets/dataset-editor";
import { db } from "@/db";
import { connections, datasets } from "@/db/schema";
import { canEdit, requireOrgBySlug } from "@/lib/rbac";

export default async function DatasetPage({
  params,
}: {
  params: Promise<{ orgSlug: string; datasetId: string }>;
}) {
  const { orgSlug, datasetId } = await params;
  const { org, role } = await requireOrgBySlug(orgSlug);

  // Explicit columns again: the connection row carries the credential
  // ciphertext, which must not reach the client component below.
  const [row] = await db
    .select({
      dataset: { id: datasets.id, name: datasets.name, sql: datasets.sql },
      connection: { id: connections.id, name: connections.name, type: connections.type },
    })
    .from(datasets)
    .innerJoin(connections, eq(connections.id, datasets.connectionId))
    .where(and(eq(datasets.id, datasetId), eq(datasets.orgId, org.id)))
    .limit(1);

  if (!row) notFound();

  return (
    <DatasetEditor
      orgSlug={orgSlug}
      dataset={row.dataset}
      connection={row.connection}
      editable={canEdit(role)}
    />
  );
}
