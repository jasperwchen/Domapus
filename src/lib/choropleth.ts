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

export {
  CHOROPLETH_COLORS,
  CLASSES,
  NO_DATA_COLOR,
  DIVERGING_COLORS,
  DIVERGING_BOUND_PCT,
} from "./choropleth.generated";

import { CHOROPLETH_COLORS } from "./choropleth.generated";

/** CSS `linear-gradient` color-stop list covering the full ramp, low → high. */
export const CHOROPLETH_GRADIENT_STOPS = CHOROPLETH_COLORS.join(", ");
