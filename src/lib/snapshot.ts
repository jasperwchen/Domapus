// The shape of `zip-data.json`, and the one place its contract is written down.
//
// The file is COLUMN-major: `d[j]` is column `j`'s values for every ZIP, not ZIP
// j's row. That is the whole reason the format changed — a column of 33,771
// numbers becomes an Int32Array in one pass and is transferred to the main thread
// rather than structured-cloned, which deletes the measured 173 ms object rebuild
// and 238 ms clone. Row-major cannot do that, because every row is its own object.
//
// `f` IS THE CONTRACT. The pipeline emits it from a single constant and the order
// is positional, so a name read from the wrong index reads a neighbouring column
// and reports, say, a relative standard error as a price.

/** Int32 minimum. Declared in the envelope; never assume it. */
export const NULL_SENTINEL = -2147483648;

export const ZIP_SPACE = 100_000;

export interface SnapshotHeader {
  format: "domapus-snapshot";
  version: number;
  null_sentinel: number;
  built_utc: string;
  /** Start of Redfin's rolling window. Paired with `period_end` for the label. */
  period_start: string | null;
  period_end: string | null;
  /**
   * Verbatim from the feed, e.g. "Rolling 3 Months". The UI labels the window
   * with THIS and never with a day count: the real window is 89-92 days, so
   * "90 days" is false for most periods. There is no `window_days`.
   */
  frequency: string;
  /** Redfin's LAST UPDATED — the curing vintage, not the reporting period. */
  vintage: string;
  zhvi_month: string | null;
  classes: number;
  dicts: Record<string, string[]>;
  scales: Record<string, number>;
  /** Class edges for the 9 painted columns only. `classes - 1` of them each. */
  breaks: Record<string, number[]>;
  classing: Record<string, string>;
  f: string[];
  z: string[];
}

/** The envelope plus its column data, as it arrives off the wire. */
export interface SnapshotPayload extends SnapshotHeader {
  d: number[][];
}

export function isSnapshotPayload(v: unknown): v is SnapshotPayload {
  if (!v || typeof v !== "object") return false;
  const p = v as Partial<SnapshotPayload>;
  return (
    p.format === "domapus-snapshot" &&
    Array.isArray(p.f) &&
    Array.isArray(p.z) &&
    Array.isArray(p.d)
  );
}
