import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { AdapterAccountType } from "next-auth/adapters";

import type { QueryColumn } from "@/lib/connectors/types";
import type { WidgetConfig } from "@/lib/widgets/types";
import type { DashboardLayout } from "@/lib/dashboards/types";

/* -------------------------------------------------------------------------- */
/* Auth.js tables                                                             */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name"),
  email: text("email").notNull().unique(),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  image: text("image"),
  // Null for users who only ever signed in through an OAuth provider.
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").$type<AdapterAccountType>().notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (t) => [primaryKey({ columns: [t.provider, t.providerAccountId] })],
);

export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (t) => [primaryKey({ columns: [t.identifier, t.token] })],
);

/* -------------------------------------------------------------------------- */
/* Tenancy                                                                    */
/* -------------------------------------------------------------------------- */

export const memberRoleEnum = pgEnum("member_role", ["owner", "editor", "viewer"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: memberRoleEnum("role").notNull().default("viewer"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] }), index("memberships_org_idx").on(t.orgId)],
);

/* -------------------------------------------------------------------------- */
/* Customer data sources                                                      */
/* -------------------------------------------------------------------------- */

export const connectionTypeEnum = pgEnum("connection_type", ["postgres", "mysql"]);

export const connections = pgTable(
  "connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: connectionTypeEnum("type").notNull(),

    // AES-256-GCM ciphertext of the full credential object (see lib/crypto.ts).
    // Never select this into anything that reaches the client.
    encryptedConfig: text("encrypted_config").notNull(),

    // Safe-to-display copies so connection lists do not need to decrypt.
    displayHost: text("display_host").notNull(),
    displayPort: integer("display_port").notNull(),
    displayDatabase: text("display_database").notNull(),
    displayUser: text("display_user").notNull(),

    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestError: text("last_test_error"),
    // Set when a connection test found the credentials can write. Surfaced as a
    // warning: customers should hand us a read-only role.
    credentialsCanWrite: boolean("credentials_can_write"),

    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("connections_org_idx").on(t.orgId)],
);

export const datasets = pgTable(
  "datasets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    sql: text("sql").notNull(),
    // Columns observed on the last successful run, used to populate the widget
    // inspector without re-running the query.
    resultSchema: jsonb("result_schema").$type<QueryColumn[]>(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("datasets_org_idx").on(t.orgId), index("datasets_connection_idx").on(t.connectionId)],
);

/* -------------------------------------------------------------------------- */
/* Dashboards                                                                 */
/* -------------------------------------------------------------------------- */

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    // react-grid-layout positions, keyed by breakpoint.
    layout: jsonb("layout").$type<DashboardLayout>().notNull().default({ lg: [] }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("dashboards_org_slug_idx").on(t.orgId, t.slug)],
);

// "share" is a 100% stacked bar, not a pie: part-to-whole reads reliably as a
// stacked bar, while a pie makes close values impossible to compare.
export const widgetTypeEnum = pgEnum("widget_type", [
  "kpi",
  "line",
  "bar",
  "share",
  "table",
  "text",
]);

export const widgets = pgTable(
  "widgets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    // Text widgets carry no dataset.
    datasetId: uuid("dataset_id").references(() => datasets.id, { onDelete: "set null" }),
    type: widgetTypeEnum("type").notNull(),
    title: text("title").notNull().default(""),
    // Field mappings and formatting; shape depends on `type`.
    config: jsonb("config").$type<WidgetConfig>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("widgets_dashboard_idx").on(t.dashboardId)],
);

/* -------------------------------------------------------------------------- */
/* Publishing                                                                 */
/* -------------------------------------------------------------------------- */

export const publications = pgTable(
  "publications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    dashboardId: uuid("dashboard_id")
      .notNull()
      .references(() => dashboards.id, { onDelete: "cascade" }),
    // Unguessable, 32 random bytes base64url-encoded. This IS the credential
    // for the public page, so it is never logged.
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("publications_dashboard_idx").on(t.dashboardId)],
);

/* -------------------------------------------------------------------------- */
/* Audit / rate limiting                                                      */
/* -------------------------------------------------------------------------- */

export const queryRuns = pgTable(
  "query_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    datasetId: uuid("dataset_id").references(() => datasets.id, { onDelete: "set null" }),
    // Set when the query was run on behalf of an anonymous visitor to a
    // published dashboard rather than a signed-in member.
    publicationId: uuid("publication_id").references(() => publications.id, {
      onDelete: "set null",
    }),
    durationMs: integer("duration_ms").notNull(),
    rowCount: integer("row_count").notNull().default(0),
    truncated: boolean("truncated").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("query_runs_org_created_idx").on(t.orgId, t.createdAt),
    // Supports the per-token rate limit window lookup.
    index("query_runs_publication_created_idx").on(t.publicationId, t.createdAt),
  ],
);

/* -------------------------------------------------------------------------- */
/* Relations                                                                  */
/* -------------------------------------------------------------------------- */

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  connections: many(connections),
  datasets: many(datasets),
  dashboards: many(dashboards),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
  org: one(organizations, { fields: [memberships.orgId], references: [organizations.id] }),
}));

export const connectionsRelations = relations(connections, ({ one, many }) => ({
  org: one(organizations, { fields: [connections.orgId], references: [organizations.id] }),
  datasets: many(datasets),
}));

export const datasetsRelations = relations(datasets, ({ one, many }) => ({
  org: one(organizations, { fields: [datasets.orgId], references: [organizations.id] }),
  connection: one(connections, {
    fields: [datasets.connectionId],
    references: [connections.id],
  }),
  widgets: many(widgets),
}));

export const dashboardsRelations = relations(dashboards, ({ one, many }) => ({
  org: one(organizations, { fields: [dashboards.orgId], references: [organizations.id] }),
  widgets: many(widgets),
  publications: many(publications),
}));

export const widgetsRelations = relations(widgets, ({ one }) => ({
  dashboard: one(dashboards, { fields: [widgets.dashboardId], references: [dashboards.id] }),
  dataset: one(datasets, { fields: [widgets.datasetId], references: [datasets.id] }),
}));

export const publicationsRelations = relations(publications, ({ one }) => ({
  dashboard: one(dashboards, {
    fields: [publications.dashboardId],
    references: [dashboards.id],
  }),
}));

/* -------------------------------------------------------------------------- */
/* Inferred types                                                             */
/* -------------------------------------------------------------------------- */

export type User = typeof users.$inferSelect;
export type Organization = typeof organizations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type MemberRole = (typeof memberRoleEnum.enumValues)[number];
export type Connection = typeof connections.$inferSelect;
export type ConnectionType = (typeof connectionTypeEnum.enumValues)[number];
export type Dataset = typeof datasets.$inferSelect;
export type Dashboard = typeof dashboards.$inferSelect;
export type Widget = typeof widgets.$inferSelect;
export type WidgetType = (typeof widgetTypeEnum.enumValues)[number];
export type Publication = typeof publications.$inferSelect;

/**
 * A connection with the credential ciphertext removed. Anything crossing the
 * server/client boundary should use this, never `Connection`.
 */
export type SafeConnection = Omit<Connection, "encryptedConfig">;

export function toSafeConnection(connection: Connection): SafeConnection {
  const { encryptedConfig: _encryptedConfig, ...safe } = connection;
  return safe;
}
