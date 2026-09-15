/**
 * Seeds the app's metadata database for local development.
 *
 * Creates one signed-in-able user, a workspace, a connection pointing at the
 * demo "customer" database from docker-compose, a few datasets and a dashboard
 * wired up to them — so `pnpm dev` opens on something that already works
 * rather than an empty state.
 *
 * Idempotent: running it twice will not duplicate anything.
 *
 * Run with: pnpm db:seed
 */

import { eq } from "drizzle-orm";

import { db } from "./index";
import {
  connections,
  dashboards,
  datasets,
  memberships,
  organizations,
  users,
  widgets,
} from "./schema";
import { encryptJson, hashPassword } from "@/lib/crypto";
import type { ConnectionCredentials } from "@/lib/connectors/types";
import { defaultSizeFor, type WidgetConfig } from "@/lib/widgets/types";
import type { DashboardLayout } from "@/lib/dashboards/types";

const DEMO_EMAIL = "demo@example.com";
const DEMO_PASSWORD = "demo-password-123";

function demoCredentials(): ConnectionCredentials {
  // Matches the demo_db service in docker-compose.yml, which grants only
  // SELECT to this role — the same read-only shape production should use.
  const url = new URL(process.env.DEMO_DATABASE_URL ?? "postgres://readonly:readonly@localhost:5434/demo_saas");
  return {
    host: url.hostname,
    port: Number(url.port || 5432),
    database: url.pathname.replace(/^\//, ""),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: false,
  };
}

const DATASET_SQL = {
  mrr: `-- Monthly recurring revenue, last 12 months
SELECT
  date_trunc('month', i.issued_at) AS month,
  SUM(i.amount_cents) / 100.0      AS revenue
FROM invoices i
WHERE i.status = 'paid'
  AND i.issued_at >= date_trunc('month', now()) - interval '11 months'
GROUP BY 1
ORDER BY 1`,

  byPlan: `-- Active revenue split by plan
SELECT
  a.plan,
  SUM(s.mrr_cents) / 100.0 AS revenue
FROM subscriptions s
JOIN accounts a ON a.id = s.account_id
WHERE s.status = 'active'
GROUP BY 1
ORDER BY 2 DESC`,

  activeAccounts: `-- Accounts that have not churned
SELECT count(*) AS active_accounts
FROM accounts
WHERE churned_at IS NULL`,

  recentAccounts: `-- Newest signups
SELECT a.name, a.plan, a.country, a.signed_up_at
FROM accounts a
ORDER BY a.signed_up_at DESC
LIMIT 25`,
} as const;

async function seed(): Promise<void> {
  console.log("Seeding the app database…");

  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, DEMO_EMAIL))
    .limit(1);

  if (existingUser) {
    console.log(`Already seeded (${DEMO_EMAIL} exists). Nothing to do.`);
    return;
  }

  const [user] = await db
    .insert(users)
    .values({
      email: DEMO_EMAIL,
      name: "Demo User",
      passwordHash: hashPassword(DEMO_PASSWORD),
    })
    .returning();
  if (!user) throw new Error("Could not create the demo user.");

  const [org] = await db
    .insert(organizations)
    .values({ name: "Acme Analytics", slug: "acme" })
    .returning();
  if (!org) throw new Error("Could not create the demo organization.");

  await db.insert(memberships).values({ userId: user.id, orgId: org.id, role: "owner" });

  const credentials = demoCredentials();
  const [connection] = await db
    .insert(connections)
    .values({
      orgId: org.id,
      name: "Demo SaaS database",
      type: "postgres",
      encryptedConfig: encryptJson(credentials),
      displayHost: credentials.host,
      displayPort: credentials.port,
      displayDatabase: credentials.database,
      displayUser: credentials.user,
      createdBy: user.id,
    })
    .returning();
  if (!connection) throw new Error("Could not create the demo connection.");

  // resultSchema is left null: the datasets have not been run yet, and running
  // them here would require the demo database to be up. Opening a dataset and
  // hitting Run fills it in, which is also the flow a real user follows.
  const inserted = await db
    .insert(datasets)
    .values([
      {
        orgId: org.id,
        connectionId: connection.id,
        name: "Monthly revenue",
        sql: DATASET_SQL.mrr,
        createdBy: user.id,
      },
      {
        orgId: org.id,
        connectionId: connection.id,
        name: "Revenue by plan",
        sql: DATASET_SQL.byPlan,
        createdBy: user.id,
      },
      {
        orgId: org.id,
        connectionId: connection.id,
        name: "Active accounts",
        sql: DATASET_SQL.activeAccounts,
        createdBy: user.id,
      },
      {
        orgId: org.id,
        connectionId: connection.id,
        name: "Newest signups",
        sql: DATASET_SQL.recentAccounts,
        createdBy: user.id,
      },
    ])
    .returning({ id: datasets.id, name: datasets.name });

  const datasetByName = new Map(inserted.map((row) => [row.name, row.id]));

  const [dashboard] = await db
    .insert(dashboards)
    .values({
      orgId: org.id,
      name: "Revenue overview",
      slug: "revenue-overview",
      layout: { lg: [] },
      createdBy: user.id,
    })
    .returning();
  if (!dashboard) throw new Error("Could not create the demo dashboard.");

  const plan: {
    type: "kpi" | "line" | "share" | "table";
    title: string;
    dataset: string;
    config: WidgetConfig;
  }[] = [
    {
      type: "kpi",
      title: "Active accounts",
      dataset: "Active accounts",
      config: { measures: ["active_accounts"], format: { style: "plain" } },
    },
    {
      type: "line",
      title: "Revenue by month",
      dataset: "Monthly revenue",
      config: {
        dimension: "month",
        measures: ["revenue"],
        format: { style: "currency", currency: "USD" },
      },
    },
    {
      type: "share",
      title: "Revenue by plan",
      dataset: "Revenue by plan",
      config: {
        dimension: "plan",
        measures: ["revenue"],
        format: { style: "currency", currency: "USD" },
      },
    },
    {
      type: "table",
      title: "Newest signups",
      dataset: "Newest signups",
      config: { columns: [] },
    },
  ];

  const createdWidgets = await db
    .insert(widgets)
    .values(
      plan.map((entry) => ({
        dashboardId: dashboard.id,
        datasetId: datasetByName.get(entry.dataset) ?? null,
        type: entry.type,
        title: entry.title,
        config: entry.config,
      })),
    )
    .returning({ id: widgets.id });

  // Lay them out top to bottom so the dashboard opens looking deliberate.
  let y = 0;
  const layout: DashboardLayout = {
    lg: createdWidgets.map((widget, index) => {
      const entry = plan[index];
      const size = defaultSizeFor(entry?.type ?? "kpi");
      const item = { i: widget.id, x: 0, y, w: size.w, h: size.h };
      y += size.h;
      return item;
    }),
  };

  await db.update(dashboards).set({ layout }).where(eq(dashboards.id, dashboard.id));

  console.log(`
Seeded.

  Sign in at http://localhost:3000/login
    email:    ${DEMO_EMAIL}
    password: ${DEMO_PASSWORD}

  Workspace: /acme
  The demo connection points at the demo_saas database from docker-compose.
  Open each dataset and hit Run once to record its columns, then open the
  "Revenue overview" dashboard.
`);
}

seed()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
