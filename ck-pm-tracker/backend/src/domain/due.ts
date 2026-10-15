import { Freq, addFreq, daysBetween, parseDate, todayISO } from "./frequency";

export type PmDef = {
  pm_key: string;
  name: string;
  category: string;
  frequency_unit: string;
  frequency_every: number;
  photo_required: boolean;
  sop_url: string | null;
  notes?: string | null; // per-site note (empty for global checklist items)
};

export type AssetRow = {
  id: string;
  type: "bot" | "lift" | "other";
  name: string;
  created_at_date: string; // YYYY-MM-DD
};

/** When is this (asset, pm) due, and by how much is it overdue. */
export function pmStatus(asset: AssetRow, pm: PmDef, lastCompleted: string | null) {
  const freq: Freq = { unit: pm.frequency_unit as Freq["unit"], every: pm.frequency_every };
  const t = todayISO();
  const due = lastCompleted ? addFreq(lastCompleted, freq) : asset.created_at_date;
  const overdue = parseDate(due) <= parseDate(t);
  // How many scheduled occurrences have come due since `due` (inclusive) → missed count.
  let cycles = 0;
  let cursor = due;
  while (parseDate(cursor) <= parseDate(t)) {
    cycles++;
    cursor = addFreq(cursor, freq);
  }
  return {
    pmKey: pm.pm_key,
    last: lastCompleted,
    due,
    never: !lastCompleted,
    overdue,
    cyclesMissed: cycles,
    daysOver: daysBetween(due, t),
  };
}

export function dueLabel(st: ReturnType<typeof pmStatus>): { text: string; tone: "red" | "amber" } {
  if (st.never) return { text: "Never logged", tone: "red" };
  if (st.overdue) {
    if (st.cyclesMissed >= 2)
      return { text: `${st.cyclesMissed} cycles missed · ~${st.cyclesMissed} mo overdue`, tone: "red" };
    return { text: `${st.daysOver}d overdue`, tone: "red" };
  }
  return { text: `due in ${-st.daysOver}d`, tone: "amber" };
}

/**
 * Build the prepopulated report queue for a site: every (asset, pm) that is
 * overdue (any amount) or due within 7 days, most-overdue first. Repeated misses
 * of one PM are inherently one row (state stores only last-completed), carrying a
 * cycle count.
 */
export function buildDueList(
  assets: AssetRow[],
  pmsByType: Record<string, PmDef[]>,
  stateMap: Record<string, string>, // `${assetId}:${pmKey}` -> last_completed
  defaults: Record<string, string | null>
) {
  const rows: any[] = [];
  for (const a of assets) {
    const pms = pmsByType[a.type] || [];
    for (const pm of pms) {
      const last = stateMap[a.id + ":" + pm.pm_key] || null;
      const st = pmStatus(a, pm, last);
      const within = st.overdue || daysBetween(todayISO(), st.due) <= 7;
      if (!within) continue;
      rows.push({
        assetId: a.id,
        assetName: a.name,
        assetType: a.type,
        pmKey: pm.pm_key,
        pmName: pm.name,
        sop: pm.sop_url || defaults[a.type] || null,
        photoRequired: pm.photo_required,
        siteNote: pm.notes || null,
        due: st.due,
        _sort: st.never ? a.created_at_date : st.due,
        label: dueLabel(st),
        cyclesMissed: st.cyclesMissed,
        never: st.never,
      });
    }
  }
  rows.sort((x, y) => parseDate(x._sort).getTime() - parseDate(y._sort).getTime());
  rows.forEach((r) => delete r._sort);
  return rows;
}
