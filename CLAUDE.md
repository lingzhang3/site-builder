# Working in this repository

A multi-tenant dashboard builder: customers connect a read-only database, save
queries as datasets, arrange widgets on a grid, and publish a dashboard as a
share link. See `README.md` for setup and the full security model.

## The rules that are load-bearing

Break these and the app stops being safe to point at someone's production
database. They are not style preferences.

1. **Two layers keep queries read-only, and both must stay.**
   `src/lib/query/guard.ts` inspects the SQL text; the connectors run it inside
   a `READ ONLY` transaction with a statement timeout and an engine-applied row
   cap. The transaction is the layer that actually holds. Never delete it on the
   grounds that the guard exists, and never add a code path that reaches a
   connector's `runQuery` without going through `src/lib/query/execute.ts`.

2. **`connections.encryptedConfig` never crosses to the client.** Server
   components and actions select explicit columns rather than whole rows for
   this reason. If you need a connection in a client component, use
   `SafeConnection`.

3. **Every tenant-scoped query goes through `src/lib/rbac.ts`.** Server Actions
   are public endpoints; an org id, dataset id or widget id arriving in a form
   field proves nothing. Re-check membership server-side. Use 404 (not 403) for
   a resource in an org the caller is not a member of.

4. **The published page sends results only.** No SQL, no connection details, no
   org or dataset ids in the payload. Keep the cache: a public URL without one
   lets any visitor re-query the customer's database on every page load.

5. **Never write to a customer database.** No migrations, no temp tables, no
   `SET` that outlives the transaction.

6. **`widgets.config` is validated with `widgetConfigSchema`, never
   `z.custom`.** It arrives from a Server Action, is stored as jsonb, and is
   rendered again — on a published page, to anonymous visitors. A value that
   throws during render (an unrecognized `format.currency` makes
   `Intl.NumberFormat` throw a RangeError) blanks the page for everyone until
   someone edits the config, so `currency.ts` guards the render path too.

## Charts

`src/lib/widgets/palette.ts` documents a **validated** categorical palette. The
slot ordering is the colorblind-safety mechanism.

- Never add a ninth series color; fold the tail into "Other".
- Never add a dual-axis chart.
- Part-to-whole is the 100% stacked bar in `share-bar.tsx`. Do not add a pie.
- `globals.css` must keep the same hexes as `palette.ts` —
  `palette.test.ts` enforces this. If you change one, change both and re-run
  the palette validator documented in `palette.ts`.

## Conventions

- Path alias `@/*` → `src/*`. Relative imports are extensionless.
- Server-only modules start with `import "server-only"`.
- Tailwind v4, CSS-first. Colors come from the tokens in `globals.css`; no
  hardcoded hex in components. Dark mode is defined in two scopes (the
  `prefers-color-scheme` media query and `[data-theme]`) so the toggle wins in
  both directions — if you add a color token, add it to both.
- UI primitives live in `src/components/ui/`. There is no component library;
  prefer extending those over adding a dependency.
- Zod validates every Server Action input.

## Tests

`pnpm test` uses Node's built-in runner against the TypeScript sources directly
(Node 22 strips types; `scripts/resolve-paths.mjs` supplies the `@/` alias and
extensionless resolution). No build step.

Unit tests cover the pure, security-critical modules. When you touch
`guard.ts`, add the bypass you are defending against as a test case — the
existing ones read as a list of attacks and that is the point. Modules that
need the database or React are covered by `pnpm test:e2e` instead.

Most of these modules are dependency-free on purpose, so they run on a bare
checkout. `config-schema.test.ts` is the exception — it imports zod, so it
needs `pnpm install` first. Prefer the dependency-free side when the logic is
security-critical: `currency.ts` is split out from the zod schema for exactly
that reason.
