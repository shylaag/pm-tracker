# Liftbot PM API

Backend for the preventive-maintenance tracker. Node + TypeScript + Express + Postgres.
Serves the report-based frontend: sites, assets, global checklists, the due-list
engine, and report submission/history.

## Run locally

```bash
cp .env.example .env          # point DATABASE_URL at a local Postgres
npm install
npm run migrate               # creates schema + seeds the 3 global checklists (no sites)
npm run dev                   # http://localhost:3001
```

`npm run migrate` is idempotent — safe to re-run.

## Deploy notes (Azure)

- **Database:** Azure Database for PostgreSQL. Set `PGSSL=require`.
- **App:** Azure App Service (Node). `npm run build` then `npm start`
  (the `migrate` script runs via `tsx`, so run it as a release step, or copy
  `src/sql` next to `dist` and adapt the path).
- **CORS:** set `CORS_ORIGIN` to the frontend URL.
- **Auth:** `src/middleware/auth.ts` is a STUB. Wire Google Workspace SSO (or
  Entra) token validation there before exposing this publicly — every write
  route already calls `requireAdmin`, so once the token sets `req.user.role`,
  gating works.

## Data model

`installations` → `assets` (bot/lift/other; the layout row is auto-created per
site) → checklists are **global** (`checklists` + `pm_definitions`, one set per
asset type). `asset_pm_state` holds last-completed per (asset, pm) and drives due
dates. `reports` + `report_items` are the immutable log; item rows snapshot
asset/PM names so history survives later edits, and keep `asset_id` on `set null`
so deleting an asset doesn't erase its history. Deleting an **installation**
cascades everything under it (the frontend guards this with a confirm step).

## Due engine

`src/domain/due.ts`. A PM is included in a site's report queue when it is overdue
(any amount) **or** due within 7 days, sorted most-overdue-first. Because state
stores only last-completed, a PM missed for N cycles is one row carrying a cycle
count (no duplicate rows). Completing it stamps `last_completed = report date`,
which recomputes the next due date. Month intervals clamp at month-end.

## API

Base path `/api`. Write routes require admin (`requireAdmin`).

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| GET | `/installations` | list sites (+ bot/lift counts) |
| POST | `/installations` | create site (auto-creates layout asset if `hasLayout`) |
| GET | `/installations/:id` | one site |
| PATCH | `/installations/:id` | edit site |
| DELETE | `/installations/:id` | delete site + all its data |
| GET | `/installations/:id/assets` | list assets |
| POST | `/installations/:id/assets` | add asset |
| DELETE | `/assets/:id` | remove asset (history preserved) |
| GET | `/checklists` | all three global checklists + PMs |
| PATCH | `/checklists/:assetType` | set default SOP url |
| PATCH | `/pm-definitions/:assetType/:pmKey` | edit a global PM (photo/interval/sop/…) |
| GET | `/installations/:id/checklists` | this site's effective checklists (forked or inherited) |
| POST | `/installations/:id/pm-items/:assetType` | add a site-specific item (auto-forks) |
| PATCH | `/installations/:id/pm-items/:assetType/:pmKey` | edit a site item: active/photo/interval/sop/notes (auto-forks) |
| DELETE | `/installations/:id/pm-items/:assetType/:pmKey` | remove a site item (auto-forks) |
| POST | `/installations/:id/checklists/:assetType/reset` | reset this site's checklist to the global default |
| GET | `/installations/:id/due` | prepopulated report queue (uses per-site checklist when forked) |
| POST | `/installations/:id/reports` | submit a report |
| GET | `/installations/:id/reports` | report history |
| GET | `/reports/:id` | one report with items |

The `/due` response shape matches what the frontend's report screen already
consumes, so wiring is a swap of the `db` layer, not a rewrite.

## Not built yet (deliberately)

Real auth, photo upload to Azure Blob (the API accepts a `photo` reference; the
bytes upload is the next slice), the Google Calendar aggregated-event job, and
the Google Sheets mirror. Timezone is stored per site but not yet used for
scheduling.

## Per-site checklists

Each site inherits the global checklist until an admin customizes it. The first
edit (or add/remove) for a (site, asset type) "forks" it: `site_checklists` marks
the pair and `site_pm_items` holds the independent copy (seeded from the global
template at fork time). From then on, global-template edits no longer flow to
that site. `/installations/:id/due` resolves per asset type — forked sites use
their active `site_pm_items`, everyone else uses the global `pm_definitions`.
"Reset to global default" drops the fork and re-inherits. Migration `003` is
additive and idempotent, so existing sites are untouched until customized.
