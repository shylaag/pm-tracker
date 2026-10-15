-- Per-site checklists. Additive and idempotent — existing sites are untouched
-- and keep inheriting the global checklist until an admin customizes them.

-- Marker: a (site, asset_type) pair that has been "forked" to a site-specific
-- checklist. Its presence is what tells the resolver to use site_pm_items for
-- that pair instead of the global pm_definitions.
create table if not exists site_checklists (
  installation_id uuid not null references installations(id) on delete cascade,
  asset_type      asset_type not null,
  created_at      timestamptz not null default now(),
  primary key (installation_id, asset_type)
);

-- The site-specific checklist items (a copy of the global template at fork time,
-- then edited independently). `active=false` means the item is unassigned from
-- this site but kept for history/visibility.
create table if not exists site_pm_items (
  id              uuid primary key default gen_random_uuid(),
  installation_id uuid not null references installations(id) on delete cascade,
  asset_type      asset_type not null,
  pm_key          text not null,
  name            text not null,
  category        text not null default 'Visual',
  frequency_unit  text not null default 'month',
  frequency_every int  not null default 1,
  photo_required  boolean not null default false,
  sop_url         text,
  notes           text not null default '',     -- per-site note shown to technicians
  sort_order      int  not null default 0,
  active          boolean not null default true,
  unique (installation_id, asset_type, pm_key)
);
create index if not exists idx_site_pm_items_site on site_pm_items(installation_id, asset_type);
