// Derive the 7-class choropleth ramp from the 12-hex source ramp by resampling
// at equal arc length in CIELAB, then report the numbers that justify it.
//
//     node scripts/palette/derive_ramp.mjs          # print the report
//     node scripts/palette/derive_ramp.mjs --write  # also write choropleth.generated.ts
//
// WHY THIS IS A SCRIPT AND NOT A LIST OF HEXES IN A COMMENT. "These colours are
// perceptually even and CVD-safe" is a claim. A claim you cannot re-derive is a
// claim you cannot defend, and this one has three numbers attached to it that an
// interviewer can reasonably ask about. Running this file answers all three.
//
// Why 7 and not 12: sequential ramps support 5-9 classes. Past that, adjacent
// swatches stop being distinguishable and the legend stops being readable, so
// the extra classes buy resolution nobody can perceive.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

const SOURCE = [
  "#FFF9B0", "#FFEB84", "#FFD166", "#FFBA49", "#FF9A56",
  "#F07857", "#E84C61", "#D43D6A", "#C13584", "#9C2A7E",
  "#7B2E8D", "#2E0B59",
];

const CLASSES = 7;

// Three absence states, three visual channels; they must not be conflated.
// "No data" is a ZCTA that is drawn but reported by neither source — it gets a
// solid grey and its own legend entry. Painting it transparent made it visually
// identical to "not a ZCTA at all" AND to a genuine zero.
const NO_DATA_COLOR = "#E8E8E8";

// Signed data on a sequential ramp is a correctness bug, not a taste question.
const DIVERGING_COLORS = [
  "#2166AC", "#67A9CF", "#D1E5F0", "#F7F7F7", "#FDDBC7", "#EF8A62", "#B2182B",
];

// --- colour maths -----------------------------------------------------------

const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const rgbToHex = (rgb) =>
  "#" + rgb.map((c) => Math.round(clamp01(c) * 255).toString(16).padStart(2, "0").toUpperCase()).join("");

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

// sRGB D65 -> XYZ, then XYZ -> CIELAB against the D65 white point.
const D65 = [0.95047, 1.0, 1.08883];
function rgbToLab(rgb) {
  const [r, g, b] = rgb.map(toLinear);
  const xyz = [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
  const f = xyz.map((v, i) => {
    const t = v / D65[i];
    return t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116;
  });
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function labToRgb([L, a, bb]) {
  const fy = (L + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - bb / 200;
  const inv = (t) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) * 27 / 24389);
  const xyz = [inv(fx) * D65[0], inv(fy) * D65[1], inv(fz) * D65[2]];
  const [x, y, z] = xyz;
  const lin = [
    3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
    -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
    0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
  ];
  return lin.map((c) => clamp01(toSrgb(clamp01(c))));
}

const deltaE76 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied in LINEAR RGB.
// Applying these to gamma-encoded values — a common shortcut — overstates the
// remaining contrast and would let a ramp pass this check that fails in reality.
const CVD = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.011820, 0.042940, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.303900],
  ],
};

function simulate(rgb, matrix) {
  const lin = rgb.map(toLinear);
  return matrix
    .map((row) => row[0] * lin[0] + row[1] * lin[1] + row[2] * lin[2])
    .map((c) => clamp01(toSrgb(clamp01(c))));
}

// --- resample ---------------------------------------------------------------

/** Sample `n` colours at equal CIELAB arc length along the source polyline. */
function resampleEqualArcLength(hexes, n) {
  const labs = hexes.map((h) => rgbToLab(hexToRgb(h)));
  const cum = [0];
  for (let i = 1; i < labs.length; i++) {
    cum.push(cum[i - 1] + deltaE76(labs[i - 1], labs[i]));
  }
  const total = cum[cum.length - 1];

  const out = [];
  for (let k = 0; k < n; k++) {
    const target = (total * k) / (n - 1);
    let seg = cum.findIndex((c, i) => i > 0 && c >= target - 1e-9);
    if (seg < 1) seg = 1;
    const span = cum[seg] - cum[seg - 1];
    const t = span === 0 ? 0 : (target - cum[seg - 1]) / span;
    const lab = labs[seg - 1].map((v, i) => v + t * (labs[seg][i] - labs[seg - 1][i]));
    out.push(rgbToHex(labToRgb(lab)));
  }
  return out;
}

// --- report -----------------------------------------------------------------

function stats(hexes) {
  const labs = hexes.map((h) => rgbToLab(hexToRgb(h)));
  const steps = labs.slice(1).map((l, i) => deltaE76(labs[i], l));
  const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
  const sd = Math.sqrt(steps.reduce((a, b) => a + (b - mean) ** 2, 0) / steps.length);

  const cvd = {};
  for (const [name, m] of Object.entries(CVD)) {
    const sim = hexes.map((h) => rgbToLab(simulate(hexToRgb(h), m)));
    cvd[name] = Math.min(...sim.slice(1).map((l, i) => deltaE76(sim[i], l)));
  }

  const lightness = labs.map((l) => l[0]);
  let monotone = true;
  for (let i = 1; i < lightness.length; i++) if (lightness[i] >= lightness[i - 1]) monotone = false;

  return {
    steps: steps.map((s) => +s.toFixed(2)),
    meanStep: +mean.toFixed(2),
    cv: +(sd / mean).toFixed(4),
    minAdjacentCvd: Object.fromEntries(
      Object.entries(cvd).map(([k, v]) => [k, +v.toFixed(2)]),
    ),
    lightness: lightness.map((l) => +l.toFixed(1)),
    lightnessMonotoneDecreasing: monotone,
  };
}

const ramp = resampleEqualArcLength(SOURCE, CLASSES);
const before = stats(SOURCE);
const after = stats(ramp);

const report = { source: SOURCE, ramp, before, after };
console.log(JSON.stringify(report, null, 2));

// The two properties the ramp has to have. Failing loudly here is the point:
// a ramp that regresses on either must not be written to source.
const CVD_FLOOR = 10; // below ~10 dE76 adjacent swatches stop being separable
const problems = [];
if (!after.lightnessMonotoneDecreasing) {
  problems.push("L* is not monotone decreasing — the ramp fails in grayscale print");
}
for (const [name, v] of Object.entries(after.minAdjacentCvd)) {
  if (v < CVD_FLOOR) problems.push(`min adjacent dE76 under ${name} is ${v}, below ${CVD_FLOOR}`);
}
if (after.cv > before.cv) {
  problems.push(`step CV got worse: ${before.cv} -> ${after.cv}`);
}
if (problems.length) {
  console.error("\nRAMP REJECTED:\n  " + problems.join("\n  "));
  process.exitCode = 1;
}

if (process.argv.includes("--write") && !problems.length) {
  const f = (n) => n.toFixed(2);
  const body = `// GENERATED by scripts/palette/derive_ramp.mjs — do not edit by hand.
//
// 7 classes resampled from the 12-hex source ramp at equal arc length in CIELAB.
// Re-derive with:  node scripts/palette/derive_ramp.mjs --write
//
// Adjacent dE76 steps: ${after.steps.join(" ")}
//   coefficient of variation ${before.cv} (12-hex source) -> ${after.cv} (this ramp)
// Minimum adjacent dE76 under simulated CVD (Machado 2009, severity 1.0):
//   protanopia ${f(after.minAdjacentCvd.protanopia)} · deuteranopia ${f(after.minAdjacentCvd.deuteranopia)} · tritanopia ${f(after.minAdjacentCvd.tritanopia)}
//   (the source ramp: ${f(before.minAdjacentCvd.protanopia)} · ${f(before.minAdjacentCvd.deuteranopia)} · ${f(before.minAdjacentCvd.tritanopia)})
// L* runs ${after.lightness[0]} -> ${after.lightness[after.lightness.length - 1]}, monotone decreasing, so it
// survives grayscale printing as well as all three CVD types.

export const CHOROPLETH_COLORS = [
${ramp.map((h) => `  "${h}",`).join("\n")}
] as const;

/** Number of classes the pipeline computes breaks for. len(breaks) === CLASSES - 1. */
export const CLASSES = ${CLASSES};

/**
 * A ZCTA that is DRAWN but reported by neither source. It is not transparent:
 * transparent made "no data" visually identical to "not a ZCTA at all" and to a
 * genuine zero. It gets its own legend entry.
 */
export const NO_DATA_COLOR = "${NO_DATA_COLOR}";

/** For signed series. Painting signed data on a sequential ramp is a correctness bug. */
export const DIVERGING_COLORS = [
${DIVERGING_COLORS.map((h) => `  "${h}",`).join("\n")}
] as const;

/** Fixed, symmetric, clamped. The end swatch reads ">= +20%", which is true in every regime. */
export const DIVERGING_BOUND_PCT = 20;
`;
  const out = join(ROOT, "src", "lib", "choropleth.generated.ts");
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, body, "utf8");
  console.error(`\nwrote ${out}`);
}
