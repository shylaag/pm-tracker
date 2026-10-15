export type Freq = { unit: "day" | "week" | "month"; every: number };

const pad = (n: number) => String(n).padStart(2, "0");

/** Date-only ISO (YYYY-MM-DD), UTC to keep interval math timezone-agnostic. */
export const isoDate = (d: Date) =>
  `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

export const parseDate = (s: string) => new Date(s + "T00:00:00Z");
export const todayISO = () => isoDate(new Date());

/** Add one interval to a date, clamping month-end (e.g. Jan 31 + 1mo = Feb 28). */
export function addFreq(dateISO: string, f: Freq): string {
  const x = parseDate(dateISO);
  if (f.unit === "month") {
    const day = x.getUTCDate();
    x.setUTCMonth(x.getUTCMonth() + f.every);
    if (x.getUTCDate() < day) x.setUTCDate(0);
  } else if (f.unit === "week") {
    x.setUTCDate(x.getUTCDate() + 7 * f.every);
  } else {
    x.setUTCDate(x.getUTCDate() + f.every);
  }
  return isoDate(x);
}

export const daysBetween = (a: string, b: string) =>
  Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000);
