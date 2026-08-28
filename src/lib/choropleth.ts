// Single source of truth for the choropleth color ramp.
//
// Used by:
//   - MapLibreMap (interactive map fill)
//   - PrintStage  (exported PNG/PDF map fill + legend gradient)
//   - Legend      (on-screen color key)
//
// These three used to carry three different lists (12 hex, 8 CSS vars, 8 hex),
// so the on-screen key showed colors the map never painted. Keep this the only
// definition — the number of colors also sets the number of quantile classes.
export const CHOROPLETH_COLORS = [
  "#FFF9B0", "#FFEB84", "#FFD166", "#FFBA49", "#FF9A56",
  "#F07857", "#E84C61", "#D43D6A", "#C13584", "#9C2A7E",
  "#7B2E8D", "#2E0B59",
] as const;

/** CSS `linear-gradient` color-stop list covering the full ramp, low → high. */
export const CHOROPLETH_GRADIENT_STOPS = CHOROPLETH_COLORS.join(", ");
