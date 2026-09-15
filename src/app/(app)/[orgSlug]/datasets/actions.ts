"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { connections, datasets } from "@/db/schema";
import { getConnector } from "@/lib/connectors";
import type { QueryResult, TableSchema } from "@/lib/connectors/types";
import { decryptCredentials, runQuery } from "@/lib/query/execute";
import { ForbiddenError, requireEditorBySlug, requireOrgBySlug } from "@/lib/rbac";

/**
 * Preview and schema browsing both hand SQL or a connection id in from the
 * browser, so both re-check editor access and org ownership of the connection.
 * A connection id in a form field proves nothing.
 */

async function loadConnection(orgId: string, connectionId: string) {
  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, orgId)))
    .limit(1);
  return connection ?? null;
}

export interface PreviewState {
  result?: QueryResult;
  error?: string;
  kind?: "invalid_sql" | "rate_limited" | "database_error";
}

export async function previewQueryAction(
  orgSlug: string,
  connectionId: string,
  sql: string,
): Promise<PreviewState> {
  let org;
  try {
    ({ org } = await requireEditorBySlug(orgSlug));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const connection = await loadConnection(org.id, connectionId);
  if (!connection) return { error: "That connection no longer exists." };

  const outcome = await runQuery({ orgId: org.id, connection, sql });
  return outcome.ok
    ? { result: outcome.result }
    : { error: outcome.error, kind: outcome.kind };
}

export interface SchemaState {
  tables?: TableSchema[];
  error?: string;
}

export async function fetchSchemaAction(
  orgSlug: string,
  connectionId: string,
): Promise<SchemaState> {
  const { org } = await requireOrgBySlug(orgSlug);

  const connection = await loadConnection(org.id, connectionId);
  if (!connection) return { error: "That connection no longer exists." };

  try {
    const tables = await getConnector(connection.type).introspectSchema(
      decryptCredentials(connection),
    );
    return { tables };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Could not read the schema." };
  }
}

const createSchema = z.object({
  name: z.string().trim().min(1, "Name the dataset.").max(120),
  connectionId: z.string().uuid("Pick a connection."),
});

export interface DatasetFormState {
  error?: string;
}

export async function createDatasetAction(
  orgSlug: string,
  _prev: DatasetFormState,
  formData: FormData,
): Promise<DatasetFormState> {
  let org;
  try {
    ({ org } = await requireEditorBySlug(orgSlug));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    connectionId: formData.get("connectionId"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const connection = await loadConnection(org.id, parsed.data.connectionId);
  if (!connection) return { error: "That connection no longer exists." };

  const [dataset] = await db
    .insert(datasets)
    .values({
      orgId: org.id,
      connectionId: connection.id,
      name: parsed.data.name,
      sql: STARTER_SQL,
    })
    .returning({ id: datasets.id });

  if (!dataset) return { error: "Could not create the dataset." };

  revalidatePath(`/${orgSlug}/datasets`);
  redirect(`/${orgSlug}/datasets/${dataset.id}`);
}

/** Starting point for a new dataset, so the editor is never blank. */
const STARTER_SQL = [
  "-- Read-only queries only. Pick a table on the left to insert a starter query.",
  "SELECT 1 AS example",
].join("\n");

export interface SaveDatasetState {
  error?: string;
  savedAt?: number;
}

export async function saveDatasetAction(
  orgSlug: string,
  datasetId: string,
  input: { name: string; sql: string },
): Promise<SaveDatasetState> {
  let org;
  try {
    ({ org } = await requireEditorBySlug(orgSlug));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const name = input.name.trim();
  if (name.length === 0) return { error: "Name the dataset." };

  const [existing] = await db
    .select({ id: datasets.id, connectionId: datasets.connectionId })
    .from(datasets)
    .where(and(eq(datasets.id, datasetId), eq(datasets.orgId, org.id)))
    .limit(1);
  if (!existing) return { error: "That dataset no longer exists." };

  const connection = await loadConnection(org.id, existing.connectionId);
  if (!connection) return { error: "That connection no longer exists." };

  // Run it once on save so the column list widgets bind to is real, and so a
  // query that cannot run never becomes a saved dataset.
  const outcome = await runQuery({
    orgId: org.id,
    connection,
    sql: input.sql,
    datasetId: existing.id,
  });

  if (!outcome.ok) return { error: outcome.error };

  await db
    .update(datasets)
    .set({
      name,
      sql: input.sql,
      resultSchema: outcome.result.columns,
      lastRunAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(datasets.id, existing.id));

  revalidatePath(`/${orgSlug}/datasets`);
  revalidatePath(`/${orgSlug}/datasets/${existing.id}`);
  return { savedAt: Date.now() };
}

export async function deleteDatasetAction(orgSlug: string, datasetId: string): Promise<void> {
  const { org } = await requireEditorBySlug(orgSlug);

  await db.delete(datasets).where(and(eq(datasets.id, datasetId), eq(datasets.orgId, org.id)));

  revalidatePath(`/${orgSlug}/datasets`);
  redirect(`/${orgSlug}/datasets`);
}
