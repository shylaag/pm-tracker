# Cartesian Kinetics — Preventive Maintenance Tracker

Internal tool for the engineering and local-ops teams to keep the Liftbot fleet
on its preventive-maintenance schedule. Admins register sites and assets and
manage checklists; technicians run per-site PM reports from the floor (mobile).

> Status: working prototype, in internal trial. **Not yet production-hardened —
> see "Known gaps" before relying on it.** This repo is for review prior to
> deployment.

## Repository layout

```
frontend/   Single-file web app (Preact + htm + Tailwind via CDN, no build step).
            Talks to the backend over HTTP. Hosted as a static page.
backend/    Node + TypeScript + Express API on Postgres. See backend/README.md
            for the full endpoint list, data model, and the due-date engine.
```

## How it works (one paragraph)

Postgres is the source of truth. Admins create **sites** and typed **assets**
(bot / lift / other). Checklists are **global by default** but can be **forked
per site** — once an admin customizes a site's checklist, that site keeps its own
independent copy (assign/unassign items, change frequency / SOP / photo rule, add
site-only items, add a technician-facing note). The **due engine** computes, per
asset + PM, what's overdue or due within 7 days, collapses repeated misses into a
single row with a cycle count, and sorts most-overdue first. Submitting a report
stamps each completed item's last-serviced date, which recomputes the next due
date. Report history is kept in full.

## Running locally

Backend:
```bash
cd backend
cp .env.example .env         # point DATABASE_URL at a local Postgres
npm install
npm run migrate:dev          # applies src/sql/001..003 (idempotent)
npm run dev                  # http://localhost:3001
```

Frontend: it's a static file. Open `frontend/index.html` after setting the API
base near the top of the file:
```js
const API_BASE = "http://localhost:3001/api";   // prod points at the deployed API
```
Serve it with any static host (or `npx serve frontend`). It is CDN-dependent, so
it needs network access to load Preact/Tailwind.

## Current deployment (trial)

- Backend: Render (Node web service + managed Postgres), migrations run on deploy.
- Frontend: static host (Netlify), `API_BASE` pointed at the Render URL.
- These are free-tier trial targets; the backend idles to sleep (~50s cold start).
  The same code is intended to move to Azure (App Service + Azure Postgres) — no
  code changes, only env/SSL config (`PGSSL=require`).

## Known gaps (please factor into review)

- **No authentication yet.** `backend/src/middleware/auth.ts` is a stub that
  trusts a header and defaults everyone to admin; the frontend's Google sign-in
  screen is cosmetic. Role enforcement (Google Workspace SSO restricted to
  `@cartesiankinetics.com`, superadmin = `rasif.h@`, admin invites) is the next
  planned slice and must land before any non-trial use.
- **Photos are references only.** The report captures a filename; uploading the
  bytes (Azure Blob) is not built yet.
- **No Google Calendar / Sheets integration yet.** Planned: one aggregated
  calendar reminder per site, and a per-site Sheet mirror as an emergency backup.
- **Checklist interval to confirm:** the bot lubrication PM is seeded monthly,
  which under-services telescopic rails / belt & pulleys vs. the separate
  lubricants reference (2-week). Intentional? Admins can override per site now.

## Data safety

Migrations are additive and idempotent; `003_site_checklists.sql` adds tables
only and does not touch existing rows. Deleting a **site** cascades its assets,
state, and reports (guarded by a two-step confirm in the UI). Deleting an
**asset** preserves its report history (rows snapshot asset/PM names).
