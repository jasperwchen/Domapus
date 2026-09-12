// Single source of truth for the choropleth color ramp.
//
// Used by:
//   - choropleth-painter (the map's constant `match` expression)
//   - PrintStage  (exported PNG/PDF map fill + legend gradient)
//   - Legend      (on-screen color key)
//
// These three used to carry three different lists (12 hex, 8 CSS vars, 8 hex),
// so the on-screen key showed colors the map never painted. Keep this the only
// definition — the number of colors also sets the number of quantile classes.
//
// The ramp itself is DERIVED, not hand-picked: `scripts/palette/derive_ramp.mjs`
// resamples the 12-hex source at equal arc length in CIELAB and refuses to write
// a ramp whose L* is not monotone or whose minimum adjacent dE76 under simulated
// colour-vision deficiency falls below 10. Re-derive with `--write`; the numbers
// are in the generated file's header.

// No diverging BOUND here on purpose. The pipeline re-derives it from the pooled
// ZHVI panel every release and publishes it in the manifest; a constant sitting
// beside the colours would be a second authority that cannot be wrong loudly.
export {
  CHOROPLETH_COLORS,
  CLASSES,
  NO_DATA_COLOR,
  DIVERGING_COLORS,
} from "./choropleth.generated";

import { CHOROPLETH_COLORS } from "./choropleth.generated";

/**
 * CSS `linear-gradient` stop list covering the full ramp, low → high, with HARD
 * edges: every class gets an equal band and nothing between them is interpolated.
 *
 * Each colour is emitted twice, at the start and end of its band, which is the
 * standard way to defeat gradient interpolation. It matters here because the map
 * paints CLASSES discrete colours and a smoothly interpolated key would show
 * colours no ZIP can ever be — at 7 classes that was obvious and at 14 it would
 * be invisible, which makes it worse rather than better. 14 bands across a 256 px
 * panel are ~18 px each, so the key reads as a ramp without claiming to be one.
 */
export const CHOROPLETH_GRADIENT_STOPS = CHOROPLETH_COLORS
  .map((c, i) => {
    const n = CHOROPLETH_COLORS.length;
    return `${c} ${((i / n) * 100).toFixed(4)}% ${(((i + 1) / n) * 100).toFixed(4)}%`;
  })
  .join(", ");
