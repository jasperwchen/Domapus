// The per-ZIP history chart: a full series, the forecast ribbon, and a readout
// that follows the pointer.
//
// WHAT WAS CONFUSING ABOUT THE OLD VERSION, since the fixes only make sense
// against it. It drew three series that come from two companies on two different
// clocks — Zillow's ZHVI is a calendar-month index, Redfin's rows are a rolling
// three-month window — through one silently rescaling y-axis, so switching tabs
// changed the units, the axis and the start year with no cue that anything but
// the line had moved. The forecast was drawn as a dashed line and a ribbon past
// the last observation but never labelled ON the chart; the only explanation was
// a 10 px paragraph under a slider that appears for ZHVI alone. `low / latest /
// high` were the extremes of the series INCLUDING the forecast band, which reads
// as the ZIP's own range. And the x-axis carried two labels fourteen years apart.
//
// Progressive enhancement is still the contract. `loadHistory` never throws and
// returns null on any failure; this renders a short line in that case and the
// panel around it must not depend on anything here.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  forecastBand,
  levelsOf,
  loadHistory,
  type HistoryIndex,
  type HistoryResult,
  type ZipHistory,
} from "@/lib/history";

type SeriesKey = "zhvi" | "msp" | "hs";

const SERIES: {
  key: SeriesKey;
  label: string;
  /** Named on the tab, because the two clocks are genuinely different. */
  cadence: string;
  axis: "months" | "periods";
  money: boolean;
}[] = [
  { key: "zhvi", label: "Typical value", cadence: "Zillow · monthly index", axis: "months", money: true },
  { key: "msp", label: "Sale price", cadence: "Redfin · 3-month window", axis: "periods", money: true },
  { key: "hs", label: "Homes sold", cadence: "Redfin · 3-month window", axis: "periods", money: false },
];

const W = 340;
const H = 178;
const PAD = { l: 36, r: 10, t: 18, b: 22 };
const PLOT_W = W - PAD.l - PAD.r;
const PLOT_H = H - PAD.t - PAD.b;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Which forecast intervals the reader is offered.
const OFFERED_LEVELS = new Set(["0.5", "0.8", "0.95"]);

function fmt(v: number, money: boolean): string {
  if (!money) return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1000) return `$${Math.round(v / 1000)}k`;
  return `$${Math.round(v)}`;
}

function fmtFull(v: number, money: boolean): string {
  return money ? `$${Math.round(v).toLocaleString()}` : Math.round(v).toLocaleString();
}

/** "2026-07-31" -> "Jul 2026". */
function monthLabel(iso: string): string {
  const m = Number(iso.slice(5, 7));
  return `${MONTHS[m - 1] ?? "?"} ${iso.slice(0, 4)}`;
}

/** The month `h` steps past `iso`, for labelling forecast points that have no
 *  entry on the published axis. */
function monthsAfter(iso: string, h: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + h;
  return `${MONTHS[((m % 12) + 12) % 12]} ${y + Math.floor(m / 12)}`;
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
    return <div className="h-[190px] animate-pulse rounded-md bg-muted/40" aria-hidden />;
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
  data, series, onSeries, levelIdx, onLevel,
}: {
  data: HistoryResult;
  series: SeriesKey;
  onSeries: (s: SeriesKey) => void;
  levelIdx: number;
  onLevel: (i: number) => void;
}) {
  const { index, series: hist } = data;
  const meta = SERIES.find((s) => s.key === series)!;
  const levels = useMemo(
    () => levelsOf(index).filter((l) => OFFERED_LEVELS.has(l)),
    [index],
  );
  const level = levels[Math.min(levelIdx, levels.length - 1)] ?? "0.8";
  const svgRef = useRef<SVGSVGElement>(null);
  const [cursor, setCursor] = useState<number | null>(null);

  const available = SERIES.filter((s) => Array.isArray(hist[s.key]));
  const geom = useMemo(
    () => buildGeometry(index, hist, series, level),
    [index, hist, series, level],
  );

  // A pointer that lands on a series with no forecast must not keep an index
  // that only existed on the previous one.
  useEffect(() => { setCursor(null); }, [series]);

  if (!geom) {
    return <p className="text-xs text-muted-foreground">No {meta.label.toLowerCase()} history for this ZIP.</p>;
  }

  const note = index.notes?.[series];
  const hover = cursor === null ? null : geom.marks[cursor];

  // Pointer events rather than mouse events, so the same handler serves touch.
  // The nearest mark wins on x alone: the reader is picking a date, and requiring
  // them to also be near the line vertically would make a steep series unreadable.
  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || geom.marks.length === 0) return;
    const box = svg.getBoundingClientRect();
    const x = ((e.clientX - box.left) / box.width) * W;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < geom.marks.length; i++) {
      const d = Math.abs(geom.marks[i].x - x);
      if (d < bestD) { bestD = d; best = i; }
    }
    setCursor(best);
  };

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

      {/* The readout. Fixed height so the chart does not jump when the pointer
          enters, and it carries the cadence when idle — which is the one thing
          the old tab strip never said out loud. */}
      <div className="flex h-8 items-baseline justify-between gap-2">
        {hover ? (
          <>
            <div className="min-w-0">
              <p className="text-[11px] leading-tight text-muted-foreground">
                {hover.label}
                {hover.forecast && " · forecast"}
              </p>
              <p className="text-sm font-semibold leading-tight tabular-nums text-foreground">
                {fmtFull(hover.v, meta.money)}
              </p>
            </div>
            {hover.forecast && hover.lo != null && hover.hi != null && (
              <p className="shrink-0 text-right text-[11px] leading-tight tabular-nums text-muted-foreground">
                {Math.round(Number(level) * 100)}% range
                <br />
                {fmt(hover.lo, meta.money)} to {fmt(hover.hi, meta.money)}
              </p>
            )}
          </>
        ) : (
          <div className="min-w-0">
            <p className="text-[11px] leading-tight text-muted-foreground">{meta.cadence}</p>
            <p className="text-sm font-semibold leading-tight tabular-nums text-foreground">
              {fmtFull(geom.last, meta.money)}
              <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                {geom.lastLabel}
              </span>
            </p>
          </div>
        )}
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none"
        role="img"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setCursor(null)}
        aria-label={`${meta.label} for this ZIP from ${geom.firstYear} to ${geom.lastYear}${
          geom.band ? `, with a ${Math.round(Number(level) * 100)}% forecast band` : ""
        }`}
      >
        {/* Horizontal gridlines with their values. The chart had no y-axis at
            all, so a line could rise across the box on a 2% move or a 200% one
            and look identical. */}
        {geom.yTicks.map((t) => (
          <g key={t.v}>
            <line
              x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y}
              className="stroke-border" strokeWidth={0.5} strokeDasharray="2 3"
            />
            <text
              x={PAD.l - 5} y={t.y + 3} textAnchor="end"
              className="fill-muted-foreground" fontSize={8.5}
            >
              {fmt(t.v, meta.money)}
            </text>
          </g>
        ))}

        {/* The forecast region, shaded and separated. A dashed line alone reads
            as more data; a boundary and a caption make it read as a projection. */}
        {geom.forecastX != null && (
          <>
            <rect
              x={geom.forecastX} y={PAD.t}
              width={W - PAD.r - geom.forecastX} height={PLOT_H}
              className="fill-muted/40"
            />
            <line
              x1={geom.forecastX} x2={geom.forecastX} y1={PAD.t} y2={PAD.t + PLOT_H}
              className="stroke-muted-foreground/50" strokeWidth={0.75}
            />
            <text
              x={geom.forecastX + 3} y={PAD.t + 7}
              className="fill-muted-foreground" fontSize={8}
            >
              forecast →
            </text>
          </>
        )}

        {geom.band && <path d={geom.band} className="fill-primary/20" />}
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

        {/* A break marker is drawn only where the data actually breaks. `at` is
            null for both restated series, so today this renders for nothing. */}
        {geom.breakX != null && (
          <>
            <line
              x1={geom.breakX} x2={geom.breakX} y1={PAD.t} y2={PAD.t + PLOT_H}
              className="stroke-amber-500" strokeWidth={1} strokeDasharray="2 2"
            />
            <title>Definition changed at {note?.at}</title>
          </>
        )}

        <line
          x1={PAD.l} x2={W - PAD.r} y1={PAD.t + PLOT_H} y2={PAD.t + PLOT_H}
          className="stroke-border" strokeWidth={1}
        />
        {geom.xTicks.map((t) => (
          <text
            key={t.label + t.x}
            x={t.x} y={H - 6} textAnchor="middle"
            className="fill-muted-foreground" fontSize={8.5}
          >
            {t.label}
          </text>
        ))}

        {hover && (
          <>
            <line
              x1={hover.x} x2={hover.x} y1={PAD.t} y2={PAD.t + PLOT_H}
              className="stroke-foreground/40" strokeWidth={0.75}
            />
            <circle
              cx={hover.x} cy={hover.y} r={3}
              className="fill-primary stroke-background" strokeWidth={1.5}
            />
          </>
        )}
      </svg>

      {geom.band && levels.length > 1 && (
        <div className="flex items-center justify-between gap-2">
          {/* The caption has to say what the percentage MEANS, because the
              selector alone reads as a display option. It is not: it is the
              share of backtest origins whose actual value landed inside the
              shaded band, so a higher level draws a wider band for the same
              forecast, not a better one. */}
          <p className="text-[10px] leading-snug text-muted-foreground">
            12-month forecast of the Zillow index, not of the sale price. The band is
            where the value landed this often in backtesting.
          </p>
          <label className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground">
            <span className="sr-only">Forecast confidence level</span>
            <select
              value={Math.min(levelIdx, levels.length - 1)}
              onChange={(e) => onLevel(Number(e.target.value))}
              className="rounded border border-border bg-card px-1 py-0.5 text-[10px] tabular-nums"
            >
              {levels.map((l, i) => (
                <option key={l} value={i}>{Math.round(Number(l) * 100)}% band</option>
              ))}
            </select>
          </label>
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

/** One addressable point on the chart — what the pointer snaps to. */
interface Mark {
  x: number;
  y: number;
  v: number;
  label: string;
  forecast: boolean;
  lo?: number;
  hi?: number;
}

interface Geometry {
  line: string;
  forecastLine: string | null;
  band: string | null;
  breakX: number | null;
  /** x of the last observation, where the forecast region begins. */
  forecastX: number | null;
  marks: Mark[];
  yTicks: { v: number; y: number }[];
  xTicks: { x: number; label: string }[];
  last: number;
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

  const present = values
    .map((v, i) => [i, v] as const)
    .filter((p): p is readonly [number, number] => p[1] != null);
  if (present.length < 2) return null;

  // The forecast only exists for ZHVI. Extending the x-axis past the last
  // observation is what makes the ribbon read as a projection rather than as
  // more data.
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
  if (!(max > min)) max = min + 1;

  const sx = (i: number) => PAD.l + ((i - xMin) / Math.max(xMax - xMin, 1)) * PLOT_W;
  const sy = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * PLOT_H;

  const line = present
    .map(([i, v], k) => `${k ? "L" : "M"}${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join("");

  let forecastLine: string | null = null;
  let band: string | null = null;
  if (bands.length) {
    const lastV = present[present.length - 1][1];
    forecastLine =
      `M${sx(lastObsIdx).toFixed(1)},${sy(lastV).toFixed(1)}` +
      bands.map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.point).toFixed(1)}`).join("");
    const upper = bands
      .map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.hi).toFixed(1)}`)
      .join("");
    const lower = bands
      .slice()
      .reverse()
      .map((b) => `L${sx(lastObsIdx + b.h).toFixed(1)},${sy(b.lo).toFixed(1)}`)
      .join("");
    band = `M${sx(lastObsIdx).toFixed(1)},${sy(lastV).toFixed(1)}${upper}${lower}Z`;
  }

  const lastAxis = axis[Math.min(lastObsIdx, axis.length - 1)];
  const marks: Mark[] = present.map(([i, v]) => ({
    x: sx(i), y: sy(v), v, label: monthLabel(axis[i]), forecast: false,
  }));
  for (const b of bands) {
    marks.push({
      x: sx(lastObsIdx + b.h),
      y: sy(b.point),
      v: b.point,
      label: monthsAfter(lastAxis, b.h),
      forecast: true,
      lo: b.lo,
      hi: b.hi,
    });
  }

  const yTicks = [min, (min + max) / 2, max].map((v) => ({ v, y: sy(v) }));

  // Four year ticks at most, taken from real axis entries so a tick never names a
  // date the series does not cover.
  const span = lastObsIdx - xMin;
  const wanted = Math.min(4, Math.max(2, Math.floor(span / 12)));
  const xTicks: { x: number; label: string }[] = [];
  for (let k = 0; k < wanted; k++) {
    const i = Math.round(xMin + (span * k) / (wanted - 1));
    xTicks.push({ x: sx(i), label: axis[i].slice(0, 4) });
  }

  const at = index.notes?.[series]?.at ?? null;
  const breakIdx = at ? axis.indexOf(at) : -1;

  return {
    line,
    forecastLine,
    band,
    breakX: breakIdx >= 0 ? sx(breakIdx) : null,
    forecastX: bands.length ? sx(lastObsIdx) : null,
    marks,
    yTicks,
    xTicks,
    last: present[present.length - 1][1],
    lastLabel: monthLabel(lastAxis),
    firstYear: axis[xMin].slice(0, 4),
    lastYear: lastAxis.slice(0, 4),
  };
}
