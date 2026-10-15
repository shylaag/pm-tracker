import { Router, Request, Response } from "express";
import { pool } from "../db/pool";
import { buildDueList, AssetRow, PmDef } from "../domain/due";
import { requireAdmin } from "../middleware/auth";

export const api = Router();

/** Wrap async handlers so thrown errors become 500s instead of hanging. */
const wrap =
  (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response) =>
    fn(req, res).catch((err) => {
      console.error(err);
      res.status(500).json({ error: "server_error", detail: String(err?.message || err) });
    });

const dateStr = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

const slug = (s: string) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28) || "item";

/**
 * Ensure a (site, asset_type) checklist is "forked": a site-specific copy of the
 * global template exists. No-op if already forked. Must run inside a transaction
 * client. After this, the site diverges independently from the global template.
 */
async function ensureFork(client: any, siteId: string, assetType: string) {
  const m = await client.query(
    `select 1 from site_checklists where installation_id = $1 and asset_type = $2`,
    [siteId, assetType]
  );
  if (m.rowCount) return;
  await client.query(
    `insert into site_checklists(installation_id, asset_type) values ($1,$2) on conflict do nothing`,
    [siteId, assetType]
  );
  await client.query(
    `insert into site_pm_items
       (installation_id, asset_type, pm_key, name, category, frequency_unit, frequency_every, photo_required, sop_url, notes, sort_order, active)
     select $1, asset_type, pm_key, name, category, frequency_unit, frequency_every, photo_required, sop_url, '', sort_order, active
       from pm_definitions where asset_type = $2
     on conflict (installation_id, asset_type, pm_key) do nothing`,
    [siteId, assetType]
  );
}

api.get("/health", (_req, res) => res.json({ ok: true }));

/* ---------------- installations ------------------------------------------ */
api.get(
  "/installations",
  wrap(async (_req, res) => {
    const { rows } = await pool.query(`
      select i.*,
        (select count(*) from assets a where a.installation_id = i.id and a.type = 'bot')  as bots,
        (select count(*) from assets a where a.installation_id = i.id and a.type = 'lift') as lifts
      from installations i
      order by i.created_at desc`);
    res.json(rows);
  })
);

api.post(
  "/installations",
  requireAdmin,
  wrap(async (req, res) => {
    const { name, timezone = "America/Los_Angeles", notes = "", hasLayout = true, calendarId = null } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name_required" });
    const client = await pool.connect();
    try {
      await client.query("begin");
      const ins = await client.query(
        `insert into installations(name, timezone, notes, has_layout, calendar_id)
         values ($1,$2,$3,$4,$5) returning *`,
        [String(name).trim(), timezone, notes, hasLayout, calendarId]
      );
      const site = ins.rows[0];
      if (hasLayout) {
        await client.query(
          `insert into assets(installation_id, type, name, serial)
           values ($1, 'other', 'Layout & infrastructure', '—')`,
          [site.id]
        );
      }
      await client.query("commit");
      res.status(201).json(site);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

api.get(
  "/installations/:id",
  wrap(async (req, res) => {
    const { rows } = await pool.query(`select * from installations where id = $1`, [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  })
);

api.patch(
  "/installations/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const map: Record<string, string> = {
      name: "name",
      timezone: "timezone",
      notes: "notes",
      hasLayout: "has_layout",
      calendarId: "calendar_id",
    };
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const [k, col] of Object.entries(map)) {
      if (k in (req.body || {})) {
        sets.push(`${col} = $${i++}`);
        vals.push(req.body[k]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `update installations set ${sets.join(", ")} where id = $${i} returning *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  })
);

// Hard delete — cascades assets, state, reports, items. Frontend guards with a
// two-step confirmation before calling this.
api.delete(
  "/installations/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(`delete from installations where id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  })
);

/* ---------------- assets -------------------------------------------------- */
api.get(
  "/installations/:id/assets",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select * from assets where installation_id = $1 order by type, name`,
      [req.params.id]
    );
    res.json(rows);
  })
);

api.post(
  "/installations/:id/assets",
  requireAdmin,
  wrap(async (req, res) => {
    const { type, name, serial = "—" } = req.body || {};
    if (!["bot", "lift", "other"].includes(type)) return res.status(400).json({ error: "invalid_type" });
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name_required" });
    const { rows } = await pool.query(
      `insert into assets(installation_id, type, name, serial) values ($1,$2,$3,$4) returning *`,
      [req.params.id, type, String(name).trim(), String(serial).trim() || "—"]
    );
    res.status(201).json(rows[0]);
  })
);

api.delete(
  "/assets/:id",
  requireAdmin,
  wrap(async (req, res) => {
    const { rowCount } = await pool.query(`delete from assets where id = $1`, [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: "not_found" });
    res.status(204).end();
  })
);

/* ---------------- checklists (global) ------------------------------------- */
api.get(
  "/checklists",
  wrap(async (_req, res) => {
    const cls = await pool.query(`select * from checklists`);
    const pms = await pool.query(`select * from pm_definitions where active order by asset_type, sort_order`);
    const byType: Record<string, any> = {};
    for (const c of cls.rows)
      byType[c.asset_type] = { assetType: c.asset_type, label: c.label, defaultSopUrl: c.default_sop_url, pms: [] };
    for (const p of pms.rows) byType[p.asset_type]?.pms.push(p);
    res.json(byType);
  })
);

api.patch(
  "/checklists/:assetType",
  requireAdmin,
  wrap(async (req, res) => {
    const { defaultSopUrl } = req.body || {};
    const { rows } = await pool.query(
      `update checklists set default_sop_url = $1 where asset_type = $2 returning *`,
      [defaultSopUrl || null, req.params.assetType]
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  })
);

api.patch(
  "/pm-definitions/:assetType/:pmKey",
  requireAdmin,
  wrap(async (req, res) => {
    const map: Record<string, string> = {
      name: "name",
      category: "category",
      photoRequired: "photo_required",
      sopUrl: "sop_url",
      frequencyUnit: "frequency_unit",
      frequencyEvery: "frequency_every",
      active: "active",
    };
    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;
    for (const [k, col] of Object.entries(map)) {
      if (k in (req.body || {})) {
        sets.push(`${col} = $${i++}`);
        vals.push(req.body[k]);
      }
    }
    if (!sets.length) return res.status(400).json({ error: "no_fields" });
    vals.push(req.params.assetType, req.params.pmKey);
    const { rows } = await pool.query(
      `update pm_definitions set ${sets.join(", ")}
       where asset_type = $${i} and pm_key = $${i + 1} returning *`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: "not_found" });
    res.json(rows[0]);
  })
);

/* ---------------- per-site checklists ------------------------------------- */
// Effective checklists for a site: the site's own copy if it has been forked,
// otherwise the global template (flagged `forked:false` so the UI can show it as
// inherited).
api.get(
  "/installations/:id/checklists",
  wrap(async (req, res) => {
    const siteId = req.params.id;
    const cls = await pool.query(`select * from checklists order by asset_type`);
    const markersQ = await pool.query(
      `select asset_type from site_checklists where installation_id = $1`,
      [siteId]
    );
    const forked = new Set(markersQ.rows.map((r) => r.asset_type));
    const siteQ = await pool.query(
      `select * from site_pm_items where installation_id = $1 order by asset_type, sort_order`,
      [siteId]
    );
    const globalQ = await pool.query(`select * from pm_definitions order by asset_type, sort_order`);
    const siteByType: Record<string, any[]> = {};
    for (const r of siteQ.rows) (siteByType[r.asset_type] || (siteByType[r.asset_type] = [])).push(r);
    const globalByType: Record<string, any[]> = {};
    for (const r of globalQ.rows) (globalByType[r.asset_type] || (globalByType[r.asset_type] = [])).push(r);

    const byType: Record<string, any> = {};
    for (const c of cls.rows) {
      const t = c.asset_type;
      const isForked = forked.has(t);
      byType[t] = {
        assetType: t,
        label: c.label,
        defaultSopUrl: c.default_sop_url,
        forked: isForked,
        pms: isForked ? (siteByType[t] || []) : (globalByType[t] || []),
      };
    }
    res.json(byType);
  })
);

// Add a site-specific checklist item (auto-forks the site's checklist first).
api.post(
  "/installations/:id/pm-items/:assetType",
  requireAdmin,
  wrap(async (req, res) => {
    const siteId = req.params.id;
    const assetType = req.params.assetType;
    const { name, category = "Visual", frequencyUnit = "month", frequencyEvery = 1, photoRequired = false, sopUrl = null, notes = "" } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: "name_required" });
    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureFork(client, siteId, assetType);
      const ord = await client.query(
        `select coalesce(max(sort_order), 0) + 1 as n from site_pm_items where installation_id = $1 and asset_type = $2`,
        [siteId, assetType]
      );
      const pmKey = slug(name) + "-" + Math.random().toString(36).slice(2, 7);
      const { rows } = await client.query(
        `insert into site_pm_items
           (installation_id, asset_type, pm_key, name, category, frequency_unit, frequency_every, photo_required, sop_url, notes, sort_order, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) returning *`,
        [siteId, assetType, pmKey, String(name).trim(), category, frequencyUnit, Math.max(1, Number(frequencyEvery) || 1), !!photoRequired, sopUrl || null, notes || "", ord.rows[0].n]
      );
      await client.query("commit");
      res.status(201).json(rows[0]);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

// Update one site checklist item (auto-forks first if the site is still inherited).
api.patch(
  "/installations/:id/pm-items/:assetType/:pmKey",
  requireAdmin,
  wrap(async (req, res) => {
    const siteId = req.params.id;
    const assetType = req.params.assetType;
    const pmKey = req.params.pmKey;
    const map: Record<string, string> = {
      name: "name",
      category: "category",
      photoRequired: "photo_required",
      sopUrl: "sop_url",
      frequencyUnit: "frequency_unit",
      frequencyEvery: "frequency_every",
      notes: "notes",
      active: "active",
    };
    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureFork(client, siteId, assetType);
      const sets: string[] = [];
      const vals: any[] = [];
      let i = 1;
      for (const [k, col] of Object.entries(map)) {
        if (k in (req.body || {})) { sets.push(`${col} = $${i++}`); vals.push(req.body[k]); }
      }
      if (!sets.length) { await client.query("rollback"); return res.status(400).json({ error: "no_fields" }); }
      vals.push(siteId, assetType, pmKey);
      const { rows } = await client.query(
        `update site_pm_items set ${sets.join(", ")}
         where installation_id = $${i} and asset_type = $${i + 1} and pm_key = $${i + 2} returning *`,
        vals
      );
      await client.query("commit");
      if (!rows[0]) return res.status(404).json({ error: "not_found" });
      res.json(rows[0]);
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

// Remove a site checklist item entirely (auto-forks first).
api.delete(
  "/installations/:id/pm-items/:assetType/:pmKey",
  requireAdmin,
  wrap(async (req, res) => {
    const { id: siteId, assetType, pmKey } = req.params;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await ensureFork(client, siteId, assetType);
      await client.query(
        `delete from site_pm_items where installation_id = $1 and asset_type = $2 and pm_key = $3`,
        [siteId, assetType, pmKey]
      );
      await client.query("commit");
      res.status(204).end();
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

// Reset a site's checklist for one asset type back to the global template.
api.post(
  "/installations/:id/checklists/:assetType/reset",
  requireAdmin,
  wrap(async (req, res) => {
    const { id: siteId, assetType } = req.params;
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(`delete from site_pm_items where installation_id = $1 and asset_type = $2`, [siteId, assetType]);
      await client.query(`delete from site_checklists where installation_id = $1 and asset_type = $2`, [siteId, assetType]);
      await client.query("commit");
      res.status(204).end();
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

/* ---------------- due list (report prepopulation) ------------------------- */
api.get(
  "/installations/:id/due",
  wrap(async (req, res) => {
    const assetsQ = await pool.query(
      `select id, type, name, created_at::date as created_at_date
       from assets where installation_id = $1`,
      [req.params.id]
    );
    const assets: AssetRow[] = assetsQ.rows.map((r) => ({
      id: r.id,
      type: r.type,
      name: r.name,
      created_at_date: dateStr(r.created_at_date),
    }));

    // Resolve the effective checklist per asset type: forked sites use their own
    // active items; everyone else uses the global active template.
    const markersQ = await pool.query(
      `select asset_type from site_checklists where installation_id = $1`,
      [req.params.id]
    );
    const forked = new Set(markersQ.rows.map((r) => r.asset_type));
    const siteItemsQ = await pool.query(
      `select * from site_pm_items where installation_id = $1 and active order by asset_type, sort_order`,
      [req.params.id]
    );
    const globalQ = await pool.query(`select * from pm_definitions where active order by asset_type, sort_order`);
    const siteByType: Record<string, PmDef[]> = {};
    for (const p of siteItemsQ.rows) (siteByType[p.asset_type] || (siteByType[p.asset_type] = [])).push(p);
    const globalByType: Record<string, PmDef[]> = {};
    for (const p of globalQ.rows) (globalByType[p.asset_type] || (globalByType[p.asset_type] = [])).push(p);
    const pmsByType: Record<string, PmDef[]> = {};
    for (const t of ["bot", "lift", "other"]) {
      pmsByType[t] = forked.has(t) ? (siteByType[t] || []) : (globalByType[t] || []);
    }

    const clsQ = await pool.query(`select asset_type, default_sop_url from checklists`);
    const defaults: Record<string, string | null> = {};
    for (const c of clsQ.rows) defaults[c.asset_type] = c.default_sop_url;

    const ids = assets.map((a) => a.id);
    const stateMap: Record<string, string> = {};
    if (ids.length) {
      const stQ = await pool.query(
        `select asset_id, pm_key, last_completed::date as last_completed
         from asset_pm_state where asset_id = any($1)`,
        [ids]
      );
      for (const s of stQ.rows) stateMap[s.asset_id + ":" + s.pm_key] = dateStr(s.last_completed);
    }

    res.json(buildDueList(assets, pmsByType, stateMap, defaults));
  })
);

/* ---------------- reports ------------------------------------------------- */
api.post(
  "/installations/:id/reports",
  wrap(async (req, res) => {
    const { technician, date, timeLog = "", safety = [], items = [] } = req.body || {};
    if (!technician || !String(technician).trim()) return res.status(400).json({ error: "technician_required" });
    if (!date) return res.status(400).json({ error: "date_required" });

    const client = await pool.connect();
    try {
      await client.query("begin");
      const rep = await client.query(
        `insert into reports(installation_id, technician, report_date, time_log, safety)
         values ($1,$2,$3,$4,$5) returning *`,
        [req.params.id, String(technician).trim(), date, timeLog, JSON.stringify(safety)]
      );
      const report = rep.rows[0];

      for (const it of items) {
        await client.query(
          `insert into report_items
             (report_id, asset_id, asset_name, pm_key, pm_name, status, notes, photo_ref, cycles_cleared)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            report.id,
            it.assetId || null,
            it.assetName || "",
            it.pmKey,
            it.pmName,
            it.status,
            it.notes || "",
            it.photo ? JSON.stringify(it.photo) : null,
            it.status === "done" ? it.cyclesMissed || 0 : 0,
          ]
        );
        if (it.status === "done" && it.assetId) {
          await client.query(
            `insert into asset_pm_state(asset_id, pm_key, last_completed, updated_at)
             values ($1,$2,$3, now())
             on conflict (asset_id, pm_key)
             do update set last_completed = excluded.last_completed, updated_at = now()`,
            [it.assetId, it.pmKey, date]
          );
        }
      }
      await client.query("commit");
      res.status(201).json({ id: report.id });
    } catch (e) {
      await client.query("rollback");
      throw e;
    } finally {
      client.release();
    }
  })
);

api.get(
  "/installations/:id/reports",
  wrap(async (req, res) => {
    const { rows } = await pool.query(
      `select * from reports where installation_id = $1 order by report_date desc, created_at desc`,
      [req.params.id]
    );
    res.json(rows);
  })
);

api.get(
  "/reports/:id",
  wrap(async (req, res) => {
    const rep = await pool.query(`select * from reports where id = $1`, [req.params.id]);
    if (!rep.rows[0]) return res.status(404).json({ error: "not_found" });
    const items = await pool.query(`select * from report_items where report_id = $1`, [req.params.id]);
    res.json({ ...rep.rows[0], items: items.rows });
  })
);
