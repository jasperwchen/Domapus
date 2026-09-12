// How a class boundary is written down, and which boundaries get written down.
//
// Shared by the on-screen `Legend` and by `PrintStage`, which draws the same key
// twice — once as DOM for the preview and once onto the export canvas. They used
// to carry two different formatters: this one, and a substring test in
// PrintStage that read `median_ppsf` as neither a price nor a ratio and printed
// `285.73` where the map's own key said `$286`.

import { METRICS } from "./metrics";
import { CHOROPLETH_COLORS } from "./choropleth";

/**
 * A level, formatted from the metric registry rather than by sniffing the key
 * name. The old substring test read "months_of_supply" as neither price nor
 * ratio and fell through to a raw number, and would have read any future
 * "*_price_ratio" as a price because "price" matched first.
 */
export function formatLegendValue(value: number, metric: string): string {
  switch (METRICS[metric]?.format) {
    case "price":
      return value >= 1_000_000
        ? `$${(value / 1_000_000).toFixed(1)}M`
        : value >= 1000
          ? `$${(value / 1000).toFixed(0)}k`
          : `$${value.toFixed(0)}`;
    case "percent":
      return `${value.toFixed(0)}%`;
    case "months":
      return value.toFixed(1);
    case "days":
      return `${Math.round(value)}d`;
    default:
      return value >= 1000 ? `${(value / 1000).toFixed(1)}k` : value.toLocaleString();
  }
}

export interface LegendTick {
  /** Index into the break list, so the label can be drawn at the boundary it
   *  names rather than at an evenly-spaced guess. */
  i: number;
  label: string;
  /** Where the boundary sits along the colour strip, 0..1. */
  pos: number;
}

/** `count` boundaries spread evenly across `b`, each with the fraction of the
 *  strip it sits at. Boundary `i` is the edge between class `i` and `i+1`, so it
 *  falls at `(i + 1) / CLASSES` of the way along. */
export function tickAt(b: readonly number[], count: number, metric: string): LegendTick[] {
  const n = CHOROPLETH_COLORS.length;
  return Array.from({ length: count }, (_, k) => {
    const i = Math.round((k * (b.length - 1)) / (count - 1));
    return { i, label: formatLegendValue(b[i], metric), pos: (i + 1) / n };
  });
}
