// The one colour ramp, used by the map, the Legend and the export. Derived by
// `scripts/palette/derive_ramp.mjs --write`, never hand-edited. No diverging bound here:
// the pipeline publishes it in the manifest.
export {
  CHOROPLETH_COLORS,
  CLASSES,
  NO_DATA_COLOR,
  DIVERGING_COLORS,
} from "./choropleth.generated";

import { CHOROPLETH_COLORS } from "./choropleth.generated";

/** CSS gradient stops with hard edges, one equal band per class, so the key never shows a
 *  colour the map cannot paint. */
export const CHOROPLETH_GRADIENT_STOPS = CHOROPLETH_COLORS
  .map((c, i) => {
    const n = CHOROPLETH_COLORS.length;
    return `${c} ${((i / n) * 100).toFixed(4)}% ${(((i + 1) / n) * 100).toFixed(4)}%`;
  })
  .join(", ");
