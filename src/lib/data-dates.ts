import { dataUrl } from "./data-url";

// last_updated.json, fetched once. Show `period_end` / `zhvi_period_end` (data freshness),
// never `last_updated_utc` (when the cron ran).

export interface DataDates {
  last_updated_utc: string | null;
  period_end: string | null;
  zhvi_period_end: string | null;
}

const EMPTY: DataDates = { last_updated_utc: null, period_end: null, zhvi_period_end: null };

let cached: Promise<DataDates> | null = null;

export function fetchDataDates(): Promise<DataDates> {
  if (cached) return cached;

  const url = dataUrl("last_updated.json");
  cached = fetch(url)
    .then((res) => {
      if (!res.ok) throw new Error(`last_updated.json returned ${res.status}`);
      return res.json();
    })
    .then((json) => ({
      last_updated_utc: json.last_updated_utc ?? null,
      period_end: json.period_end ?? null,
      zhvi_period_end: json.zhvi_period_end ?? null,
    }))
    .catch((err) => {
      // Reset so a later caller can retry, then degrade to "unknown" rather
      // than blocking render on a metadata file.
      cached = null;
      throw err;
    });

  return cached;
}

function parsePeriod(period: string | null | undefined): Date | null {
  if (!period) return null;
  const parsed = new Date(`${period}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * "2026-05-31" -> "May 2026". Correct for ZHVI, which is a smoothed monthly
 * index. Do NOT use it for Redfin — see formatRedfinWindow.
 */
export function formatPeriod(period: string | null | undefined): string {
  const parsed = parsePeriod(period);
  if (!parsed) return "N/A";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** "2026-05-31" -> "May 31, 2026". */
export function formatPeriodDay(period: string | null | undefined): string {
  const parsed = parsePeriod(period);
  if (!parsed) return "N/A";
  return parsed.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

/**
 * "2026-07-31" -> "3 months ending Jul 31, 2026". Redfin rows are a rolling window of 89-92
 * days, so never "July 2026" and never "90 days".
 */
export function formatRedfinWindow(period: string | null | undefined): string {
  const parsed = parsePeriod(period);
  if (!parsed) return "N/A";
  const day = parsed.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  return `3 months ending ${day}`;
}

const DAY_MS = 86_400_000;
// `serialize.STALE_WARN_DAYS`: the pipeline publishes past this and promises this banner.
const STALE_AT_BUILD_DAYS = 45;
// A healthy period is ~20 days old on release day and ~50 just before the next one, so past
// 65 at view time a monthly release has been missed.
const STALE_AT_VIEW_DAYS = 65;

/** The older of the two periods when the data is staler than a healthy monthly cycle, else null. */
export function stalePeriod(dates: DataDates, now: Date = new Date()): string | null {
  const built = dates.last_updated_utc ? new Date(dates.last_updated_utc) : null;
  let oldest: string | null = null;
  for (const period of [dates.period_end, dates.zhvi_period_end]) {
    const end = parsePeriod(period);
    if (!end) continue;
    const viewAge = (now.getTime() - end.getTime()) / DAY_MS;
    const buildAge = built ? (built.getTime() - end.getTime()) / DAY_MS : 0;
    if ((viewAge > STALE_AT_VIEW_DAYS || buildAge > STALE_AT_BUILD_DAYS)
        && (!oldest || period! < oldest)) {
      oldest = period;
    }
  }
  return oldest;
}

export { EMPTY as EMPTY_DATA_DATES };
