# Site Builder

Connect the database behind your SaaS tools, write a query, and arrange the
results into a dashboard you can share with a link.

Built as a multi-tenant web app: sign up, invite your team, add read-only
database connections, save queries as datasets, drag widgets onto a grid, and
publish the result as an unguessable read-only URL that needs no sign-in.

> **Scope.** This is the first slice: PostgreSQL and MySQL connections, and
> dashboards. CSV upload, REST/GraphQL connectors, SaaS OAuth connectors
> (Stripe, HubSpot, Google) and the marketing-site builder are deliberately not
> here yet — see [Roadmap](#roadmap).

## Quick start

Requires Node 22.18+ (it runs TypeScript directly, which `pnpm test` and
`pnpm db:seed` rely on), pnpm, and Docker.

```bash
pnpm install
docker compose up -d                 # app database + a seeded demo "customer" database

cp .env.example .env
# Fill in the two secrets the file tells you to generate:
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"   # APP_ENCRYPTION_KEY

# The demo database is on localhost, which the SSRF guard blocks by default.
echo 'ALLOW_PRIVATE_DB_HOSTS=true' >> .env

pnpm db:push                         # create the app schema
pnpm db:seed                         # a demo user, workspace, connection and dashboard
pnpm dev                             # http://localhost:3000
```

Sign in as `demo@example.com` / `demo-password-123`, open each dataset and press
**Run** once (that records its columns), then open the **Revenue overview**
dashboard.

## How it fits together

```
Customer's database  ──read-only──▶  Dataset (saved SQL)  ──▶  Widget  ──▶  Dashboard  ──▶  /p/<token>
      (never written)                                                                      (no sign-in)
```

Two Postgres instances, and the distinction matters:

- **App database** (`DATABASE_URL`, port 5433) — this app's own metadata. Drizzle
  owns its schema.
- **Customer databases** — read-only, always. This app never creates, migrates
  or writes to them. `docker compose` runs one seeded stand-in on port 5434 with
  a `readonly` role, so local development exercises the same permissions
  production should.

| Area | Where |
|---|---|
| Schema | `src/db/schema.ts` |
| Read-only SQL enforcement | `src/lib/query/guard.ts`, `src/lib/connectors/*.ts` |
| Credential encryption | `src/lib/crypto.ts` |
| Tenancy checks | `src/lib/rbac.ts` |
| Data source drivers | `src/lib/connectors/` |
| Published-page serving | `src/lib/publications.ts` |
| Chart colors and rules | `src/lib/widgets/palette.ts` |

## The security model

This app holds credentials to other people's production databases and serves
their data to anonymous visitors, so a few things are load-bearing.

**Queries cannot write, enforced twice.** `guard.ts` tokenizes the SQL and
rejects writes, multiple statements, data-modifying CTEs
(`WITH x AS (DELETE … RETURNING *) SELECT * FROM x`, which a "starts with
SELECT" check waves through), MySQL executable comments (`/*!50000 DROP … */`,
which the server runs), filesystem functions and `pg_sleep`. Text analysis of
SQL can always be argued with, so it is only the first layer: every statement
also runs inside a `READ ONLY` transaction with a statement timeout, and the
row cap is applied by the engine (`LIMIT n+1`) rather than in Node. **Never
remove the second layer on the grounds that the first exists.**

**Credentials are encrypted at rest.** AES-256-GCM under `APP_ENCRYPTION_KEY`,
with a versioned payload so the key can be rotated. A tampered row fails to
decrypt rather than yielding garbage. `encryptedConfig` is never selected into
anything that crosses to the client — the pages select explicit columns for
this reason, and `SafeConnection` exists to make the safe shape the easy one.

**Connections cannot reach your own infrastructure.** `host-guard.ts` rejects
loopback, RFC1918, carrier-NAT and link-local addresses — including
`169.254.169.254`, the cloud metadata endpoint — so "add a data source" is not
an SSRF primitive. `ALLOW_PRIVATE_DB_HOSTS=true` opens it up for local
development only.

**Published links are treated as credentials.** The token is 32 random bytes.
Unknown, revoked and expired tokens all render the same 404, so the page cannot
be used to probe which links existed. Results are cached per (token, widget) —
without that, a public URL is a free load generator aimed at a customer's
production database — and queries are rate limited per token. Revoking
invalidates the cache immediately rather than waiting out the TTL. The payload
carries results only: no SQL, no connection details, no org or dataset ids. The
page is `noindex`.

**Tenancy is re-checked server-side, every time.** Server Actions are public
HTTP endpoints, so an id in a form field proves nothing. Every tenant-scoped
read and write goes through `rbac.ts`, which joins through `memberships`. A slug
the caller is not a member of returns 404, not 403, so the app does not leak
which organizations exist.

**Ask customers for a read-only database user.** The app checks whether the
credentials can write and warns in the UI if so. The read-only transaction means
a bug here cannot damage their data even with over-privileged credentials, but
least privilege is still the right setup.

## Charts

Chart design follows a documented method rather than taste, and the parts that
can be computed are computed.

The eight categorical series colors in `src/lib/widgets/palette.ts` are a
**validated** set — the slot ordering is what makes them distinguishable under
colorblind simulation, which is why a ninth series folds into "Other" instead of
getting a generated hue. `globals.css` carries the same values as CSS custom
properties so light and dark swap without JavaScript, and
`palette.test.ts` asserts the two stay in sync — otherwise drift would silently
ship a palette that was never validated.

Consequences worth knowing before you change something:

- **No dual-axis charts.** Two measures that cannot share a scale belong in two
  widgets; a second y-scale invents a correlation that is not in the data.
- **Part-to-whole is a 100% stacked bar, not a pie.** Readers cannot compare
  close slices by angle, and a pie's segments are all mutually adjacent, which
  the palette only stays safe for at three of them. The widget is called "Share
  of total".
- **Every chart has a table view.** Three of the light-mode series colors fall
  below 3:1 contrast against the surface, which obliges an alternative route to
  the values. It doubles as the accessible alternative to hovering.
- **A legend appears from two series up**, so identity never rests on color
  alone.

## Commands

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm test           # unit tests (bare Node, no install needed beyond deps)
pnpm test:e2e       # Playwright end-to-end
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm db:push        # apply the schema to the app database
pnpm db:studio      # browse the app database
pnpm db:seed        # demo data
```

`pnpm test` runs on Node's built-in test runner against the TypeScript sources
directly — `scripts/resolve-paths.mjs` teaches Node the `@/` alias and
extensionless imports so the tests exercise production code as written. The
suite concentrates on the security-critical pure modules: the SQL guard (every
bypass listed above has a test), credential encryption, the SSRF classifier,
query limits, tenancy role rules, and the chart palette and transforms.

`pnpm test:e2e` needs the compose databases up and `pnpm db:push` run; it walks
the whole path from sign-up to opening a published link in an anonymous browser
context, and asserts the published HTML contains neither the SQL nor the
connection details.

## Roadmap

In rough order of how cheaply each extends what is here. `Connector` in
`src/lib/connectors/types.ts` (`testConnection` / `introspectSchema` /
`runQuery`) is the extension point for the first three.

1. CSV / Excel upload — removes the "hand over your production connection
   string" step from onboarding, which is the biggest friction in the current
   flow.
2. Configurable REST / GraphQL connector — one implementation covers any SaaS
   API without per-vendor code.
3. SaaS OAuth connectors (Stripe, HubSpot, Google Analytics) — best experience,
   but each vendor is its own piece of work.
4. Marketing-site builder, reusing the same grid engine with content blocks.
5. Team invitations, billing.

Known gaps: the host guard resolves a hostname and checks the answers, but the
driver resolves it again when it connects, so DNS rebinding is not fully closed
off — pinning the checked address and dialling it directly is the fix. The
per-token rate limit is a fixed window over `query_runs`, which permits a burst
at a window boundary.
