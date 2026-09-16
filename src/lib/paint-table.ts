// One byte per ZIP, indexed by the ZIP as an integer ("00501" -> 501).
//   bits 0-3  class + 1 (0 = no data)   bits 4-5  reliability tier 0..3   bits 6-7  reserved
// The reliability nibble is metric-invariant (median sale price tier). Layout is written by
// pipeline/paint.py.

import { ZIP_SPACE } from "./snapshot";

const EXPECTED_BYTES = ZIP_SPACE;

/** Listing-side metrics that must not be faded by a sales statistic. Mirrors paint.FADE_EXEMPT. */
export const FADE_EXEMPT: ReadonlySet<string> = new Set(["active_listings"]);

export class PaintTable {
  private constructor(
    private readonly t: Uint8Array,
    readonly metric: string,
  ) {}

  /** Throws on a wrong byte length (404 or truncated body) or a class count the ramp cannot draw. */
  static from(
    buf: ArrayBuffer,
    metric: string,
    manifestClasses: number,
    rampLength: number,
  ): PaintTable {
    if (buf.byteLength !== EXPECTED_BYTES) {
      throw new Error(
        `paint table for ${metric}: ${buf.byteLength} bytes, expected ${EXPECTED_BYTES}`,
      );
    }
    if (manifestClasses !== rampLength) {
      throw new Error(
        `paint table for ${metric}: manifest declares ${manifestClasses} classes, ` +
          `the colour ramp has ${rampLength}`,
      );
    }
    return new PaintTable(new Uint8Array(buf), metric);
  }

  /** 0..K-1, or -1 when this ZIP has no value for this metric. */
  classOf(zip: string): number {
    const k = +zip;
    // A non-numeric id would index NaN and read undefined.
    if (!Number.isInteger(k) || k < 0 || k >= ZIP_SPACE) return -1;
    return (this.t[k] & 0x0f) - 1;
  }

  /** 0 low .. 3 high, or -1 where there is no value at all. */
  reliabilityOf(zip: string): number {
    const k = +zip;
    if (!Number.isInteger(k) || k < 0 || k >= ZIP_SPACE) return -1;
    const b = this.t[k];
    return (b & 0x0f) === 0 ? -1 : (b >> 4) & 0x03;
  }

  /** Every ZIP this table has a class for. Built once, on demand. */
  zips(): string[] {
    const out: string[] = [];
    for (let i = 0; i < ZIP_SPACE; i++) {
      if (this.t[i] & 0x0f) out.push(String(i).padStart(5, "0"));
    }
    return out;
  }
}
