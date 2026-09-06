// One byte per ZIP: what colour it is, and how much to trust it.
//
//   byte index = the ZIP as a base-10 integer.  "00501" -> 501.
//   byte value = (reliability_tier << 4) | (class_index + 1)
//
//     bits 0-3  class index + 1, in 1..7.  0 => no data for this ZIP.
//     bits 4-5  reliability tier 0..3.
//     bits 6-7  reserved, always 0.
//
// ZIP codes are five digits, so the ZIP IS the array index — a perfect hash with
// no lookup structure, no parse, and no worker. Reading a class is one array read
// and one mask. The table is 100,000 bytes raw and ~24 KB on the wire, against the
// 2.5 MB snapshot that used to gate the first coloured pixel.
//
// The reliability nibble is METRIC-INVARIANT: it always carries the ZIP's median
// sale price tier, which is a property of the transaction sample rather than of
// whatever is painted. That is what lets the pipeline assert the paint table and
// the snapshot agree, and it is why `reliabilityOf` does not take a metric.

import { ZIP_SPACE } from "./snapshot";

const EXPECTED_BYTES = ZIP_SPACE;

/** Metrics the reliability fade must NOT be applied to.
 *
 *  ACTIVE LISTINGS is a listing-side series that does not depend on sales at all,
 *  and thousands of ZIPs carry active listings with no sales at all — for those
 *  the sale-sample tier is undefined and the encoder writes tier 0. Fading a
 *  listings map by a sales statistic, hardest exactly where there were no sales,
 *  would be a lie the byte layout makes easy. The pipeline declares the same set
 *  in `paint.py`; these two must not drift.
 *
 *  MONTHS OF SUPPLY is deliberately absent: it is inventory over the sales rate,
 *  so it does derive from homes sold, and the fade is correct there. */
export const FADE_EXEMPT: ReadonlySet<string> = new Set(["active_listings"]);

export class PaintTable {
  private constructor(
    private readonly t: Uint8Array,
    readonly metric: string,
  ) {}

  /**
   * Refuses to construct rather than painting a lie. A wrong byteLength means the
   * fetch got a 404 body or a truncated response; a class-count mismatch means the
   * legend and the map would disagree about what a colour means.
   */
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
    // Guard explicitly: a non-numeric feature id would otherwise index NaN, and
    // `Uint8Array[NaN]` is `undefined`, which silently becomes NaN downstream.
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
