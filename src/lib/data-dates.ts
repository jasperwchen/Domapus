import { dataUrl } from "./data-url";

// Fetches public/data/last_updated.json once and shares the result.
//
// Two different dates live in that file and they mean different things:
//   - period_end        the newest Redfin reporting period actually in the data
//   - zhvi_period_end   the newest Zillow ZHVI month actually in the data
//   - last_updated_utc  when the pipeline last ran (NOT how fresh the data is)
//
// The UI must show the period_end dates. Showing last_updated_utc made the site
// claim the data was current whenever the cron job ran, even if the upstream
// feed had not published a new month in the meantime.

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
 * "2026-07-31" -> "3 months ending Jul 31, 2026".
 *
 * Redfin's ZIP-level rows are a rolling three-month window, not a snapshot of
 * that month. Rendering "July 2026" claims a monthly figure the feed never
 * publishes.
 *
 * It says "3 months", NOT "90 days". The window is calendar-aligned, so its
 * inclusive length takes four values across the file: 92 days x 2,857,977 rows,
 * 91 x 1,026,380, 90 x 733,207, 89 x 312,436. The old feed's uniform
 * PERIOD_DURATION == 90 has no successor here, and `FREQUENCY == 'Rolling 3
 * Months'` is the contract the pipeline asserts instead. No UI copy may say
 * "90 days".
 */
export function formatRedfinWindow(period: string | null | undefined): string {
  const parsed = parsePeriod(period);
  if (!parsed) return "N/A";
  const day = parsed.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric",
  });
  return `3 months ending ${day}`;
}

export { EMPTY as EMPTY_DATA_DATES };
