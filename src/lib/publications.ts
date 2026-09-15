import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";

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
import type { DashboardLayout } from "@/lib/dashboards/types";
import { getPublicCacheTtlSeconds } from "@/lib/query/limits";
import { runQuery } from "@/lib/query/execute";
import type { WidgetConfig } from "@/lib/widgets/types";
import { isDataWidget } from "@/lib/widgets/types";

/**
 * Serving a published dashboard.
 *
 * The visitor is anonymous, so every query runs on the owning organization's
 * behalf. That makes this the most sensitive path in the app, and it is built
 * around three rules:
 *
 *  1. **Only results cross the boundary.** The payload sent to the browser
 *     contains widget titles, configs and rows — never SQL, never a connection,
 *     never an org or dataset id.
 *  2. **Results are cached.** Without a cache, a public URL is a free load
 *     generator aimed at the customer's production database: one refresh per
 *     visitor per widget. The TTL floor is enforced in `limits.ts`.
 *  3. **Queries are rate limited per token**, which `runQuery` applies when it
 *     is given a `publicationId`. That only happens on a cache miss, which is
 *     the behaviour we want.
 */

export interface PublicWidget {
  id: string;
  type: WidgetType;
  title: string;
  config: WidgetConfig;
  datasetName: string | null;
  result: QueryResult | null;
  error: string | null;
}

export interface PublicDashboardView {
  name: string;
  layout: DashboardLayout;
  widgets: PublicWidget[];
  /** For the "data as of" line, so a viewer knows they may be seeing a cache. */
  generatedAt: string;
}

interface PublicationRecord {
  publicationId: string;
  orgId: string;
  dashboardId: string;
  name: string;
  layout: DashboardLayout;
}

/**
 * Resolves a share token. Returns null for unknown, revoked and expired
 * tokens alike — a viewer should not be able to tell which, and the page
 * renders the same 404 for all three.
 */
export async function resolvePublicationToken(token: string): Promise<PublicationRecord | null> {
  // A token is 43 base64url characters; anything wildly off is not worth a
  // database round trip.
  if (token.length < 20 || token.length > 200) return null;

  const [row] = await db
    .select({
      publicationId: publications.id,
      expiresAt: publications.expiresAt,
      orgId: dashboards.orgId,
      dashboardId: dashboards.id,
      name: dashboards.name,
      layout: dashboards.layout,
    })
    .from(publications)
    .innerJoin(dashboards, eq(dashboards.id, publications.dashboardId))
    .where(and(eq(publications.token, token), isNull(publications.revokedAt)))
    .limit(1);

  if (!row) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  return {
    publicationId: row.publicationId,
    orgId: row.orgId,
    dashboardId: row.dashboardId,
    name: row.name,
    layout: row.layout,
  };
}

/**
 * Builds the view for a published dashboard, with each widget's data cached
 * per (token, widget) for the configured TTL.
 */
export async function loadPublicDashboard(token: string): Promise<PublicDashboardView | null> {
  const publication = await resolvePublicationToken(token);
  if (!publication) return null;

  const rows = await db
    .select({
      widgetId: widgets.id,
      type: widgets.type,
      title: widgets.title,
      config: widgets.config,
      datasetId: datasets.id,
      datasetName: datasets.name,
      sql: datasets.sql,
      connection: connections,
    })
    .from(widgets)
    .leftJoin(datasets, eq(datasets.id, widgets.datasetId))
    .leftJoin(connections, eq(connections.id, datasets.connectionId))
    .where(eq(widgets.dashboardId, publication.dashboardId))
    .orderBy(widgets.createdAt);

  const ttl = getPublicCacheTtlSeconds();

  const widgetViews = await Promise.all(
    rows.map(async (row): Promise<PublicWidget> => {
      const base = {
        id: row.widgetId,
        type: row.type,
        title: row.title,
        config: row.config ?? {},
        datasetName: row.datasetName,
      };

      if (!isDataWidget(row.type)) {
        return { ...base, result: null, error: null };
      }

      if (!row.datasetId || !row.sql || !row.connection) {
        return { ...base, result: null, error: "This widget is not configured." };
      }

      const connection = row.connection;
      const sql = row.sql;
      const datasetId = row.datasetId;

      const cached = unstable_cache(
        async (): Promise<{ result?: QueryResult; error?: string }> => {
          const outcome = await runQuery({
            orgId: publication.orgId,
            connection,
            sql,
            datasetId,
            // Enables the per-token rate limit, and tags the audit record as
            // having been run for a public visitor.
            publicationId: publication.publicationId,
          });

          return outcome.ok
            ? { result: outcome.result }
            : {
                // The viewer is not the dashboard's owner, so driver detail
                // would leak schema and host information. Owners still get the
                // real message in the editor and in query_runs.
                error:
                  outcome.kind === "rate_limited"
                    ? outcome.error
                    : "This widget could not be loaded.",
              };
        },
        // Keyed by token so revoking and re-publishing serves fresh data, and
        // by widget so one slow query does not hold up the rest.
        ["public-widget", token, row.widgetId],
        { revalidate: ttl, tags: [`publication:${publication.publicationId}`] },
      );

      const data = await cached();
      return { ...base, result: data.result ?? null, error: data.error ?? null };
    }),
  );

  return {
    name: publication.name,
    layout: publication.layout,
    widgets: widgetViews,
    generatedAt: new Date().toISOString(),
  };
}
