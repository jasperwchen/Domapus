// The per-ZIP history chart (spec Phase 7): a full series, the forecast ribbon, and a
// confidence slider that reconstructs the band client-side from the published sigma-unit
// quantile table.
//
// Progressive enhancement is the contract. `loadHistory` never throws and returns null on any
// failure, and this component renders a short explanatory line in that case. The sidebar
// around it must not depend on anything here.

import { useEffect, useMemo, useState } from "react";
import {
  forecastBand,
  levelsOf,
  loadHistory,
  type HistoryIndex,
  type HistoryResult,
  type ZipHistory,
} from "@/lib/history";

type SeriesKey = "zhvi" | "msp" | "hs";

const SERIES: { key: SeriesKey; label: string; axis: "months" | "periods"; money: boolean }[] = [
  { key: "zhvi", label: "Typical value", axis: "months", money: true },
  { key: "msp", label: "Median sale price", axis: "periods", money: true },
  { key: "hs", label: "Homes sold", axis: "periods", money: false },
];

const W = 320;
const H = 110;
const PAD = { l: 4, r: 4, t: 8, b: 16 };

function fmt(v: number, money: boolean): string {
  if (!money) return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
}

function yearOf(iso: string): string {
  return iso.slice(2, 4);
}

export function Sparkline({ zipCode }: { zipCode: string }) {
  const [state, setState] = useState<"loading" | "ready" | "absent">("loading");
  const [data, setData] = useState<HistoryResult | null>(null);
  const [series, setSeries] = useState<SeriesKey>("zhvi");
  const [levelIdx, setLevelIdx] = useState(1); // 0.80, the nominal band

  useEffect(() => {
    let live = true;
    setState("loading");
    setData(null);
    loadHistory(zipCode).then((r) => {
      if (!live) return;
      setData(r);
      setState(r ? "ready" : "absent");
    });
    return () => {
      live = false;
    };
  }, [zipCode]);

  if (state === "loading") {
    return <div className="h-[150px] animate-pulse rounded-md bg-muted/40" aria-hidden />;
  }
  if (state === "absent" || !data) {
    return (
      <p className="text-xs text-muted-foreground">
        History is unavailable for this ZIP right now. Everything else on this panel is current.
      </p>
    );
  }
  return (
    <Chart
      data={data}
      series={series}
      onSeries={setSeries}
      levelIdx={levelIdx}
      onLevel={setLevelIdx}
    />
  );
}

function Chart({
  data,
  series,
  onSeries,
  levelIdx,
  onLevel,
}: {
  data: HistoryResult;
  series: SeriesKey;
  onSeries: (s: SeriesKey) => void;
  levelIdx: number;
  onLevel: (i: number) => void;
}) {
  const { index, series: hist } = data;
  const meta = SERIES.find((s) => s.key === series)!;
  const levels = useMemo(() => levelsOf(index), [index]);
  const level = levels[Math.min(levelIdx, levels.length - 1)] ?? "0.8";

  const available = SERIES.filter((s) => Array.isArray(hist[s.key]));
  const geom = useMemo(
    () => buildGeometry(index, hist, series, level),
    [index, hist, series, level],
  );

  if (!geom) {
    return <p className="text-xs text-muted-foreground">No {meta.label.toLowerCase()} history for this ZIP.</p>;
  }

  const note = index.notes?.[series];

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {available.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSeries(s.key)}
            aria-pressed={s.key === series}
            className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
              s.key === series
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${meta.label} for this ZIP from ${geom.firstYear} to ${geom.lastYear}${
          geom.band ? `, with a ${Math.round(Number(level) * 100)}% forecast band` : ""
        }`}
      >
        {geom.band && (
          <path d={geom.band} className="fill-primary/15" />
        )}
        {geom.forecastLine && (
          <path
            d={geom.forecastLine}
            className="stroke-primary/70"
            strokeWidth={1.5}
            strokeDasharray="3 2"
            fill="none"
          />
        )}
        <path d={geom.line} className="stroke-primary" strokeWidth={1.5} fill="none" />

        {/* A break marker is drawn only where the data actually breaks. `at` is null for
            both restated series, so today this renders for nothing — see history.py. */}
        {geom.breakX != null && (
          <>
            <line
              x1={geom.breakX}
              x2={geom.breakX}
              y1={PAD.t}
              y2={H - PAD.b}
              className="stroke-amber-500"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <title>Definition changed at {note?.at}</title>
          </>
        )}

        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={H - PAD.b}
          y2={H - PAD.b}
          className="stroke-border"
          strokeWidth={1}
        />
        <text x={PAD.l} y={H - 4} className="fill-muted-foreground" fontSize={9}>
          ’{geom.firstLabel}
        </text>
        <text x={W - PAD.r} y={H - 4} textAnchor="end" className="fill-muted-foreground" fontSize={9}>
          ’{geom.lastLabel}
        </text>
      </svg>

      <div className="flex items-baseline justify-between text-[11px] text-muted-foreground tabular-nums">
        <span>low {fmt(geom.min, meta.money)}</span>
        <span className="font-semibold text-foreground">
          latest {fmt(geom.last, meta.money)}
        </span>
        <span>high {fmt(geom.max, meta.money)}</span>
      </div>

      {geom.band && (
        <div className="space-y-1">
          <label className="flex items-baseline justify-between text-[11px] text-muted-foreground">
            <span>Forecast confidence</span>
            <span className="font-semibold tabular-nums text-foreground">
              {Math.round(Number(level) * 100)}%
            </span>
          </label>
          <input
            type="range"
            min={0}
            max={levels.length - 1}
            step={1}
            value={Math.min(levelIdx, levels.length - 1)}
            onChange={(e) => onLevel(Number(e.target.value))}
            className="w-full accent-primary"
            aria-label="Forecast confidence level"
          />
          <p className="text-[10px] leading-snug text-muted-foreground">
            12-month forecast of the Zillow ZHVI value index, not of the sale price shown
            above. The band is this ZIP’s own residual spread at the level you pick.
          </p>
        </div>
      )}

      {note?.note && (
        <p className="text-[10px] leading-snug text-amber-700 dark:text-amber-500">
          {note.note}
        </p>
      )}
    </div>
  );
}

interface Geometry {
  line: string;
  forecastLine: string | null;
  band: string | null;
  breakX: number | null;
  min: number;
  max: number;
  last: number;
  /** Two digits for the axis tick; the full year for the screen-reader label. */
  firstLabel: string;
  lastLabel: string;
  firstYear: string;
  lastYear: string;
}

function buildGeometry(
  index: HistoryIndex,
  hist: ZipHistory,
  series: SeriesKey,
  level: string,
): Geometry | null {
  const meta = SERIES.find((s) => s.key === series)!;
  const values = hist[series];
  const axis = meta.axis === "months" ? index.zhvi_months : index.periods;
  if (!values || values.length !== axis.length) return null;

  const present = values.map((v, i) => [i, v] as const).filter((p): p is readonly [number, number] => p[1] != null);
  if (present.length < 2) return null;

  // The forecast only exists for ZHVI. Extending the x-axis past the last observation is what
  // makes the ribbon read as a projection rather than as more data.
  const bands =
    series === "zhvi"
      ? index.horizons
          .map((h, k) => {
            const b = forecastBand(index, hist, k, level);
            return b ? { h, ...b } : null;
          })
          .filter((b): b is { h: number; point: number; lo: number; hi: number } => b !== null)
      : [];

  const lastObsIdx = present[present.length - 1][0];
  const xMax = lastObsIdx + (bands.length ? bands[bands.length - 1].h : 0);
  const xMin = present[0][0];

  let min = Infinity;
  let max = -Infinity;
  for (const [, v] of present) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  for (const b of bands) {
    if (b.lo < min) min = b.lo;
    if (b.hi > max) max = b.hi;
  }
  if (!(max > min)) {
    max = min + 1;
  }

  const sx = (i: number) => PAD.l + ((i - xMin) / Math.max(xMax - xMin, 1)) * (W - PAD.l - PAD.r);
  const sy = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  const line = present.map(([i, v], k) => `${k ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join("");

  let forecastLine: string | null = null;
  let band: string | null = null;
  if (bands.length) {
    const lastV = present[present.length - 1][1];
    forecastLine =
      `M${sx(lastObsIdx).toFixed(1)},${sy(lastV).toFixed(1)}` +
      bands.map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.point).toFixed(1)}`).join("");
    const upper = bands.map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.hi).toFixed(1)}`).join("");
    const lower = bands
      .slice()
      .reverse()
      .map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.lo).toFixed(1)}`)
      .join("");
    band = `M${sx(lastObsIdx).toFixed(1)},${sy(lastV).toFixed(1)}${upper}${lower}Z`;
  }

  const at = index.notes?.[series]?.at ?? null;
  const breakIdx = at ? axis.indexOf(at) : -1;
  const breakX = breakIdx >= 0 ? sx(breakIdx) : null;

  return {
    line,
    forecastLine,
    band,
    breakX,
    min,
    max,
    last: present[present.length - 1][1],
    firstLabel: yearOf(axis[xMin]),
    lastLabel: yearOf(axis[Math.min(lastObsIdx, axis.length - 1)]),
    firstYear: axis[xMin].slice(0, 4),
    lastYear: axis[Math.min(lastObsIdx, axis.length - 1)].slice(0, 4),
  };
}
