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

  const url = new URL(`${import.meta.env.BASE_URL}data/last_updated.json`, window.location.origin).href;
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

/** "2026-05-31" -> "May 2026". Periods are month-ends, so the day adds nothing. */
export function formatPeriod(period: string | null | undefined): string {
  if (!period) return "N/A";
  const parsed = new Date(`${period}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "N/A";
  return parsed.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export { EMPTY as EMPTY_DATA_DATES };
