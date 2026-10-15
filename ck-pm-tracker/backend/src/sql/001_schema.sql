-- Idempotent schema. Safe to re-run.

create extension if not exists "pgcrypto";

do $$ begin
  if not exists (select 1 from pg_type where typname = 'asset_type') then
    create type asset_type as enum ('bot', 'lift', 'other');
  end if;
end $$;

create table if not exists installations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  timezone    text not null default 'America/Los_Angeles',
  notes       text not null default '',
  has_layout  boolean not null default true,
  calendar_id text,
  created_at  timestamptz not null default now()
);

create table if not exists assets (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  type            asset_type not null,
  name            text not null,
  serial          text not null default '—',
  created_at      timestamptz not null default now()
);
create index if not exists idx_assets_installation on assets(installation_id);

-- Global checklists (one per asset type). Per-site divergence is future scope.
create table if not exists checklists (
  asset_type      asset_type primary key,
  label           text not null,
  default_sop_url text
);

create table if not exists pm_definitions (
  id              uuid primary key default gen_random_uuid(),
  asset_type      asset_type not null references checklists(asset_type) on delete cascade,
  pm_key          text not null,
  name            text not null,
  category        text not null,
  frequency_unit  text not null default 'month',   -- day | week | month
  frequency_every int  not null default 1,
  photo_required  boolean not null default false,
  sop_url         text,                              -- null => inherit checklist default
  sort_order      int  not null default 0,
  active          boolean not null default true,
  unique (asset_type, pm_key)
);

-- Last-completed per (asset, pm). Upserted on report submit; drives due dates.
create table if not exists asset_pm_state (
  asset_id       uuid not null references assets(id) on delete cascade,
  pm_key         text not null,
  last_completed date not null,
  updated_at     timestamptz not null default now(),
  primary key (asset_id, pm_key)
);

create table if not exists reports (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  technician      text not null,
  report_date     date not null,
  time_log        text not null default '',
  safety          jsonb not null default '[]',
  created_at      timestamptz not null default now()
);
create index if not exists idx_reports_installation on reports(installation_id, report_date desc);

-- Immutable per-item log. asset_id set null on asset delete so history survives;
-- asset_name/pm_name are snapshots so history reads correctly after edits.
create table if not exists report_items (
  id             uuid primary key default gen_random_uuid(),
  report_id      uuid not null references reports(id) on delete cascade,
  asset_id       uuid references assets(id) on delete set null,
  asset_name     text not null,
  pm_key         text not null,
  pm_name        text not null,
  status         text not null check (status in ('done', 'flag', 'pending')),
  notes          text not null default '',
  photo_ref      jsonb,
  cycles_cleared int not null default 0
);
create index if not exists idx_report_items_report on report_items(report_id);
create index if not exists idx_report_items_asset on report_items(asset_id, pm_key);
