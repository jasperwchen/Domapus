import type { ZipData } from "@/components/dashboard/map/types";

// Only these two metrics have a sampling model (pipeline/noise.py): rse = K / sqrt(homes sold).
// Every other change keeps its colour because nothing says how noisy it is.
const RSE_OF: Record<string, "msp_rse" | "dom_rse"> = {
  median_sale_price: "msp_rse",
  median_dom: "dom_rse",
};

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Two standard errors of the year-over-year change, as a fraction, when the change is inside
 *  them; otherwise null. 92% of sale-price changes were inside them on the 2026-10 release.
 *
 *  The year-ago median rests on n / (1 + homes_sold_yoy) sales, so its rse^2 is
 *  rse^2 * (1 + homes_sold_yoy) and the standard error of the log change is
 *  rse * sqrt(2 + homes_sold_yoy). Without a year-ago count, equal samples are assumed. */
export function yoyNoise(zip: ZipData, metric: string): number | null {
  const key = RSE_OF[metric];
  if (!key) return null;
  const rse = zip[key];
  const now = zip[metric as keyof ZipData];
  const yoy = zip[`${metric}_yoy` as keyof ZipData];
  if (!num(rse) || !num(now) || !num(yoy)) return null;
  // Sale-price YoY is a percent; days-on-market YoY is a difference in days.
  const then = metric === "median_dom" ? now - yoy : now / (1 + yoy / 100);
  if (!(now > 0 && then > 0)) return null;
  const hs = zip.homes_sold_yoy;
  const growth = num(hs) && hs > -100 ? hs / 100 : 0;
  const band = 2 * rse * Math.sqrt(2 + growth);
  return Math.abs(Math.log(now / then)) < band ? band : null;
}

/** The same test for the gap between two ZIPs: two standard errors of log(b / a). */
export function differenceNoise(a: ZipData, b: ZipData, metric: string): number | null {
  const key = RSE_OF[metric];
  if (!key) return null;
  const ra = a[key], rb = b[key];
  const va = a[metric as keyof ZipData], vb = b[metric as keyof ZipData];
  if (!num(ra) || !num(rb) || !num(va) || !num(vb) || !(va > 0 && vb > 0)) return null;
  const band = 2 * Math.sqrt(ra * ra + rb * rb);
  return Math.abs(Math.log(vb / va)) < band ? band : null;
}

export const noiseNote = (band: number) => `within sampling noise (±${(band * 100).toFixed(1)}%)`;
