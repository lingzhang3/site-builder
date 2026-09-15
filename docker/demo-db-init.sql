-- Stands in for a customer's SaaS database during local development.
-- Shape mirrors what a typical B2B SaaS exposes: accounts, subscriptions,
-- invoices and product events — enough to build a real revenue dashboard.

CREATE TABLE accounts (
  id            serial PRIMARY KEY,
  name          text        NOT NULL,
  plan          text        NOT NULL CHECK (plan IN ('free', 'starter', 'growth', 'enterprise')),
  country       text        NOT NULL,
  signed_up_at  timestamptz NOT NULL,
  churned_at    timestamptz
);

CREATE TABLE subscriptions (
  id              serial PRIMARY KEY,
  account_id      int         NOT NULL REFERENCES accounts (id),
  mrr_cents       int         NOT NULL,
  status          text        NOT NULL CHECK (status IN ('active', 'past_due', 'canceled')),
  started_at      timestamptz NOT NULL,
  canceled_at     timestamptz
);

CREATE TABLE invoices (
  id           serial PRIMARY KEY,
  account_id   int         NOT NULL REFERENCES accounts (id),
  amount_cents int         NOT NULL,
  status       text        NOT NULL CHECK (status IN ('paid', 'open', 'void')),
  issued_at    timestamptz NOT NULL,
  paid_at      timestamptz
);

CREATE TABLE product_events (
  id         bigserial PRIMARY KEY,
  account_id int         NOT NULL REFERENCES accounts (id),
  event_name text        NOT NULL,
  occurred_at timestamptz NOT NULL
);

-- 120 accounts spread over the last 18 months.
INSERT INTO accounts (name, plan, country, signed_up_at, churned_at)
SELECT
  'Account ' || g,
  (ARRAY['free', 'starter', 'growth', 'enterprise'])[1 + (g * 7) % 4],
  (ARRAY['US', 'DE', 'GB', 'JP', 'CN', 'BR'])[1 + (g * 5) % 6],
  now() - ((540 - g * 4) || ' days')::interval,
  CASE WHEN g % 11 = 0 THEN now() - ((60 - g % 50) || ' days')::interval END
FROM generate_series(1, 120) AS g;

INSERT INTO subscriptions (account_id, mrr_cents, status, started_at, canceled_at)
SELECT
  a.id,
  CASE a.plan
    WHEN 'free' THEN 0
    WHEN 'starter' THEN 4900
    WHEN 'growth' THEN 24900
    ELSE 99900
  END,
  CASE
    WHEN a.churned_at IS NOT NULL THEN 'canceled'
    WHEN a.id % 13 = 0 THEN 'past_due'
    ELSE 'active'
  END,
  a.signed_up_at,
  a.churned_at
FROM accounts a
WHERE a.plan <> 'free';

-- ~18 months of monthly invoices per paying account.
INSERT INTO invoices (account_id, amount_cents, status, issued_at, paid_at)
SELECT
  s.account_id,
  s.mrr_cents,
  CASE WHEN m = 0 AND s.status = 'past_due' THEN 'open' ELSE 'paid' END,
  date_trunc('month', now()) - (m || ' months')::interval,
  CASE
    WHEN m = 0 AND s.status = 'past_due' THEN NULL
    ELSE date_trunc('month', now()) - (m || ' months')::interval + interval '3 days'
  END
FROM subscriptions s
CROSS JOIN generate_series(0, 17) AS m
WHERE s.started_at <= date_trunc('month', now()) - (m || ' months')::interval;

INSERT INTO product_events (account_id, event_name, occurred_at)
SELECT
  a.id,
  (ARRAY['login', 'dashboard_viewed', 'report_exported', 'invite_sent'])[1 + (a.id * g) % 4],
  now() - ((g * 3) || ' hours')::interval
FROM accounts a
CROSS JOIN generate_series(1, 40) AS g;

-- The app should always connect with a role that cannot write. Creating one
-- here means local development exercises the same permissions as production.
CREATE ROLE readonly WITH LOGIN PASSWORD 'readonly';
GRANT CONNECT ON DATABASE demo_saas TO readonly;
GRANT USAGE ON SCHEMA public TO readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO readonly;
