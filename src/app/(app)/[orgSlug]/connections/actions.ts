"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { connections } from "@/db/schema";
import { DEFAULT_PORTS, getConnector } from "@/lib/connectors";
import type { ConnectionCredentials } from "@/lib/connectors/types";
import { decryptJson, encryptJson } from "@/lib/crypto";
import { ForbiddenError, requireEditorBySlug } from "@/lib/rbac";

export interface ConnectionFormState {
  error?: string;
  /** Set on success so the form can show the server version and warnings. */
  notice?: string;
  canWrite?: boolean;
  ok?: boolean;
}

const credentialsSchema = z.object({
  name: z.string().trim().min(1, "Give the connection a name.").max(120),
  type: z.enum(["postgres", "mysql"]),
  host: z.string().trim().min(1, "Enter the database host."),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string().trim().min(1, "Enter the database name."),
  user: z.string().trim().min(1, "Enter the database user."),
  password: z.string(),
  ssl: z.coerce.boolean(),
});

function parseForm(formData: FormData) {
  return credentialsSchema.safeParse({
    name: formData.get("name"),
    type: formData.get("type"),
    host: formData.get("host"),
    port: formData.get("port") || DEFAULT_PORTS[(formData.get("type") as "postgres") ?? "postgres"],
    database: formData.get("database"),
    user: formData.get("user"),
    password: formData.get("password") ?? "",
    ssl: formData.get("ssl") === "on" || formData.get("ssl") === "true",
  });
}

/**
 * Validates credentials by actually connecting before storing them. A
 * connection that has never worked is worse than no connection: every
 * dashboard built on it fails later, far from the mistake.
 */
export async function createConnectionAction(
  orgSlug: string,
  _prev: ConnectionFormState,
  formData: FormData,
): Promise<ConnectionFormState> {
  let org;
  try {
    ({ org } = await requireEditorBySlug(orgSlug));
  } catch (error) {
    if (error instanceof ForbiddenError) return { error: error.message };
    throw error;
  }

  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Please check the form." };
  }

  const { name, type, ...credentials } = parsed.data;
  const test = await getConnector(type).testConnection(credentials);
  if (!test.ok) {
    return { error: test.error ?? "Could not connect with those details." };
  }

  await db.insert(connections).values({
    orgId: org.id,
    name,
    type,
    encryptedConfig: encryptJson(credentials satisfies ConnectionCredentials),
    displayHost: credentials.host,
    displayPort: credentials.port,
    displayDatabase: credentials.database,
    displayUser: credentials.user,
    lastTestedAt: new Date(),
    lastTestError: null,
    credentialsCanWrite: test.canWrite ?? null,
  });

  revalidatePath(`/${orgSlug}/connections`);
  return {
    ok: true,
    notice: test.serverVersion ? `Connected to ${test.serverVersion}` : "Connected.",
    canWrite: test.canWrite,
  };
}

/** Re-runs the connection test and stores the outcome. */
export async function testConnectionAction(
  orgSlug: string,
  connectionId: string,
): Promise<ConnectionFormState> {
  const { org } = await requireEditorBySlug(orgSlug);

  const [connection] = await db
    .select()
    .from(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, org.id)))
    .limit(1);

  if (!connection) return { error: "That connection no longer exists." };

  const credentials = decryptJson<ConnectionCredentials>(connection.encryptedConfig);
  const test = await getConnector(connection.type).testConnection(credentials);

  await db
    .update(connections)
    .set({
      lastTestedAt: new Date(),
      lastTestError: test.ok ? null : (test.error ?? "Unknown error"),
      credentialsCanWrite: test.canWrite ?? null,
    })
    .where(eq(connections.id, connection.id));

  revalidatePath(`/${orgSlug}/connections`);
  return test.ok
    ? {
        ok: true,
        notice: test.serverVersion ? `Connected to ${test.serverVersion}` : "Connected.",
        canWrite: test.canWrite,
      }
    : { error: test.error ?? "Could not connect." };
}

export async function deleteConnectionAction(
  orgSlug: string,
  connectionId: string,
): Promise<void> {
  const { org } = await requireEditorBySlug(orgSlug);

  // Datasets cascade-delete with the connection, and widgets lose their
  // dataset reference rather than disappearing, so a dashboard degrades to
  // "dataset missing" tiles instead of silently losing its layout.
  await db
    .delete(connections)
    .where(and(eq(connections.id, connectionId), eq(connections.orgId, org.id)));

  revalidatePath(`/${orgSlug}/connections`);
}
