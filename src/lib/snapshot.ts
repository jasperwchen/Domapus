// `zip-data.json`. Column-major: `d[j]` is column j. `f` is positional, so a misnamed
// index reads the neighbouring column.

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
  /** Verbatim, e.g. "Rolling 3 Months". Never label it as a day count (the window is 89-92 days). */
  frequency: string;
  /** Redfin's LAST UPDATED — the curing vintage, not the reporting period. */
  vintage: string;
  zhvi_month: string | null;
  classes: number;
  dicts: Record<string, string[]>;
  scales: Record<string, number>;
  /** Class edges for the 8 painted columns only. `classes - 1` of them each. */
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
