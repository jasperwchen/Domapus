import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  X, ArrowLeft, TrendingUp, TrendingDown, BarChart3, ChevronDown, Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ZipData } from "./map/types";
import type { ZipTable } from "@/lib/zip-table";
import {
  formatMetricValue, formatChange, METRIC_DEFINITIONS, FormatType, getStateName, LISA_LABELS,
} from "./map/utils";
import { METRIC_GROUPS } from "@/lib/metrics";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatRedfinWindow } from "@/lib/data-dates";

const ZipComparison = lazy(() => import("./ZipComparison").then(m => ({ default: m.ZipComparison })));
// Lazy so the history chart and its fetch stay off the first-paint path entirely.
const Sparkline = lazy(() => import("./Sparkline").then(m => ({ default: m.Sparkline })));

interface SidebarProps {
  isOpen: boolean;
  zipData: ZipData | null;
  store: ZipTable | null;
  onClose: () => void;
  /** What the map is currently painting. The panel leads with it, because it is
   *  the number the reader just clicked on. */
  selectedMetric: string;
  /** Owned by `HousingDashboard`, not by this component. See the note there: the
   *  local version of this state caused a map click to replace the ZIP being
   *  compared against, and survived the panel being closed. */
  mode: "detail" | "compare";
  onModeChange: (mode: "detail" | "compare") => void;
  compareZip: ZipData | null;
  onCompareZipChange: (zip: ZipData | null) => void;
}

// MIN fits the 4-column comparison table (184 px fixed + 56 px padding) with ~11 label
// characters left; MAX keeps the map the larger half.
const MIN_W = 360;
const MAX_W = 720;
const DEFAULT_W = 384; // what `w-96` was
const WIDTH_KEY = "domapus:sidebar-width";

function clampWidth(px: number): number {
  return Math.min(Math.max(px, MIN_W), Math.min(MAX_W, Math.round(window.innerWidth * 0.5)));
}

/** Panel width, remembered across sessions. Reading localStorage in the
 *  initializer rather than in an effect avoids a frame at the default width. */
function useSidebarWidth(): [number, (px: number) => void] {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(WIDTH_KEY));
      return Number.isFinite(saved) && saved > 0 ? clampWidth(saved) : DEFAULT_W;
    } catch {
      return DEFAULT_W;
    }
  });

  const set = useCallback((px: number) => {
    const w = clampWidth(px);
    setWidth(w);
    try {
      localStorage.setItem(WIDTH_KEY, String(w));
    } catch {
      // Private mode, or storage disabled. The width still works this session.
    }
  }, []);

  // A window narrow enough to violate the cap must not leave the panel over it.
  useEffect(() => {
    const onResize = () => setWidth((w) => clampWidth(w));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return [width, set];
}

export function Sidebar({
  isOpen, zipData, store, onClose,
  selectedMetric, mode, onModeChange, compareZip, onCompareZipChange,
}: SidebarProps) {
  const isMobile = useIsMobile();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useSidebarWidth();
  const [dragging, setDragging] = useState(false);

  // Focus management: move focus to heading when sidebar opens
  useEffect(() => {
    if (isOpen && zipData && headingRef.current) {
      headingRef.current.focus();
    }
  }, [isOpen, zipData]);

  if (!isOpen || !zipData) return null;

  if (!zipData.zipCode) {
    console.warn("[Sidebar] Invalid zipData: missing zipCode", zipData);
    return null;
  }

  const comparing = mode === "compare";

  return (
    <div
      ref={rootRef}
      className={`relative bg-dashboard-panel border-r border-dashboard-border shadow-lg flex flex-col h-full ${
        isMobile ? "w-full" : ""
      } ${dragging ? "select-none" : ""}`}
      style={isMobile ? undefined : { width }}
    >
      {!isMobile && (
        <ResizeHandle
          width={width}
          onWidth={setWidth}
          onDragging={setDragging}
          rootRef={rootRef}
        />
      )}
      <Header
        zipData={zipData}
        comparing={comparing}
        isMobile={isMobile}
        headingRef={headingRef}
        onClose={onClose}
      />

      <div className="flex flex-col flex-1 overflow-hidden min-h-0" aria-live="polite">
        {comparing ? (
          <div className="flex-1 overflow-y-auto px-4 py-3">
            <Suspense fallback={
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }>
              <ZipComparison
                currentZip={zipData}
                compareZip={compareZip}
                onCompareZipChange={onCompareZipChange}
                store={store}
              />
            </Suspense>
          </div>
        ) : (
          <Details zipData={zipData} selectedMetric={selectedMetric} />
        )}

        <div className="flex-none px-4 py-3 border-t border-dashboard-border bg-dashboard-panel">
          <Button
            variant={comparing ? "outline" : "default"}
            size="sm"
            className="w-full"
            onClick={() => onModeChange(comparing ? "detail" : "compare")}
          >
            {comparing ? (
              <><ArrowLeft className="h-4 w-4 mr-2" />Back to details</>
            ) : (
              <><BarChart3 className="h-4 w-4 mr-2" />Compare with another ZIP</>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * The drag target on the panel's right edge.
 *  Pointer events with capture so pen, touchpad and fast drags track. Also a keyboard
 *  `separator`, since the width it sets is real state.
 */
function ResizeHandle({
  width, onWidth, onDragging, rootRef,
}: {
  width: number;
  onWidth: (px: number) => void;
  onDragging: (v: boolean) => void;
  rootRef: React.RefObject<HTMLDivElement>;
}) {
  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    onDragging(true);
  };

  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const left = rootRef.current?.getBoundingClientRect().left ?? 0;
    onWidth(e.clientX - left);
  };

  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    onDragging(false);
  };

  const key = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 48 : 16;
    if (e.key === "ArrowLeft") { e.preventDefault(); onWidth(width - step); }
    else if (e.key === "ArrowRight") { e.preventDefault(); onWidth(width + step); }
    else if (e.key === "Home") { e.preventDefault(); onWidth(MIN_W); }
    else if (e.key === "End") { e.preventDefault(); onWidth(MAX_W); }
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize panel"
      aria-valuenow={width}
      aria-valuemin={MIN_W}
      aria-valuemax={MAX_W}
      tabIndex={0}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      onDoubleClick={() => onWidth(DEFAULT_W)}
      title="Drag to resize · double-click to reset"
      className="group absolute right-0 top-0 z-30 h-full w-3 translate-x-1/2 cursor-col-resize touch-none outline-none"
    >
      {/* The hit area is 12 px wide; the thing the eye sees is a 2 px rule that
          only appears under the pointer or focus. A permanently visible grip
          would read as a border on a panel that already has one. */}
      <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-primary/0 transition-colors group-hover:bg-primary/40 group-focus-visible:bg-primary" />
    </div>
  );
}

/** ZIP, place, and which period the numbers cover. */
function Header({
  zipData, comparing, isMobile, headingRef, onClose,
}: {
  zipData: ZipData;
  comparing: boolean;
  isMobile: boolean;
  headingRef: React.RefObject<HTMLHeadingElement>;
  onClose: () => void;
}) {
  const place = [
    zipData.city,
    zipData.state ? getStateName(zipData.state) : null,
  ].filter(Boolean).join(", ");
  const region = [
    zipData.county ? `${zipData.county} County` : null,
    zipData.metro,
  ].filter(Boolean).join(" · ");

  return (
    <div className="flex-none px-4 pt-3 pb-2.5 border-b border-dashboard-border bg-dashboard-panel z-10">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h2
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-bold tracking-tight text-foreground outline-none tabular-nums leading-none"
            >
              {zipData.zipCode}
            </h2>
            {comparing && (
              <span className="text-[10px] uppercase tracking-wider font-bold text-primary">
                Comparing
              </span>
            )}
          </div>
          {place && (
            <p className="mt-1 text-sm font-medium text-foreground truncate">{place}</p>
          )}
          {region && (
            <p className="text-xs text-muted-foreground truncate">{region}</p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`shrink-0 text-muted-foreground hover:text-foreground ${isMobile ? "h-10 w-10" : "h-8 w-8"}`}
          onClick={onClose}
          aria-label="Close panel"
        >
          <X className={isMobile ? "h-6 w-6" : "h-5 w-5"} />
        </Button>
      </div>
    </div>
  );
}

function Details({ zipData, selectedMetric }: { zipData: ZipData; selectedMetric: string }) {
  const hero = METRIC_DEFINITIONS[selectedMetric];

  return (
    <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
      {hero && <Hero zipData={zipData} metricKey={selectedMetric} />}

      <Section title="History">
        <Suspense fallback={<div className="h-[190px] animate-pulse rounded-md bg-muted/40" aria-hidden />}>
          <Sparkline zipCode={zipData.zipCode} />
        </Suspense>
      </Section>

      {/* Every group starts open. Collapsing two of the three hid nine of the
          fifteen metrics behind a chevron that reads as a section heading, so
          the panel looked like it carried six numbers. The groups still
          collapse; they just do not start that way. */}
      {METRIC_GROUPS.map((group) => (
        <MetricGroup
          key={group.id}
          label={group.label}
          keys={group.keys}
          zipData={zipData}
          highlight={selectedMetric}
        />
      ))}
    </div>
  );
}

/** The metric the map is painting, given the space the reader expects it to have.
 *
 *  Nothing used to distinguish it: the panel listed fifteen identical cards and
 *  the one the user had just clicked a colour for was somewhere in the middle. */
function Hero({ zipData, metricKey }: { zipData: ZipData; metricKey: string }) {
  const m = METRIC_DEFINITIONS[metricKey];
  const value = zipData[m.key as keyof ZipData] as number | null;
  const yoy = m.yoyKey ? formatChange(zipData[m.yoyKey] as number | null, m.yoyFormat) : null;
  const mom = m.momKey ? formatChange(zipData[m.momKey] as number | null, m.momFormat) : null;

  // The sample this estimate rests on, where one exists. `msp_rse` describes the
  // sale-price sample and `dom_rse` the days-on-market sample; neither describes
  // a listings count, so this is a whitelist and not a fallback.
  const rse = metricKey === "median_sale_price" ? zipData.msp_rse
    : metricKey === "median_dom" ? zipData.dom_rse
    : null;
  const sales = typeof zipData.homes_sold === "number" ? zipData.homes_sold : null;

  // Say which clock the number is on: ZHVI is a calendar month, Redfin a rolling three months.
  const period = metricKey.startsWith("zhvi")
    ? "Zillow · monthly index"
    : `Redfin · ${formatRedfinWindow(zipData.period_end)}`;

  return (
    <div className="rounded-lg border border-border bg-card px-3.5 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {m.label}
      </p>
      <p className="mt-0.5 text-3xl font-bold tabular-nums leading-none text-foreground">
        {value === null || value === undefined || isNaN(value)
          ? "n/a"
          : formatMetricValue(value, m.format as FormatType)}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {mom && !mom.isZero && <Delta change={mom} suffix="MoM" />}
        {yoy && !yoy.isZero && <Delta change={yoy} suffix="YoY" />}
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
        {period}
        {typeof rse === "number" && isFinite(rse) && sales !== null && (
          <>
            {" · "}±{(rse * 100).toFixed(1)}% on {sales.toLocaleString()}{" "}
            {sales === 1 ? "sale" : "sales"}
          </>
        )}
      </p>
      {typeof zipData.lisa === "number" && LISA_LABELS[zipData.lisa] && (
        <p className="mt-1.5 text-[11px] font-medium text-foreground">
          {LISA_LABELS[zipData.lisa]}
        </p>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="rounded-lg border border-border bg-card px-3.5 py-3">{children}</div>
    </section>
  );
}

/**
 * One group of metrics as `label  value  delta` rows (cards took ~1,400 px of scroll).
 */
function MetricGroup({
  label, keys, zipData, highlight,
}: {
  label: string;
  keys: string[];
  zipData: ZipData;
  highlight: string;
}) {
  const [open, setOpen] = useState(true);

  const rows = useMemo(() => keys
    .map((k) => METRIC_DEFINITIONS[k])
    .filter(Boolean)
    .map((m) => ({ m, value: zipData[m.key as keyof ZipData] as number | null }))
    .filter(({ value }) => value !== null && value !== undefined && !isNaN(value)),
    [keys, zipData]);

  if (rows.length === 0) return null;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 py-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronDown
          className={`h-3.5 w-3.5 transition-transform ${open ? "" : "-rotate-90"}`}
          aria-hidden="true"
        />
        {label}
        <span className="ml-auto font-normal normal-case tracking-normal tabular-nums opacity-60">
          {rows.length}
        </span>
      </button>

      {open && (
        <div className="rounded-lg border border-border bg-card divide-y divide-border/60">
          {/* The change column is year-over-year for fourteen of the fifteen
              metrics, so it is named once here rather than repeated on every
              row. ZHVI is the exception — it is the only series Redfin's rolling
              window does not apply to, so it is the only one with a real
              month-over-month — and that row carries its own "MoM" marker. */}
          <div className="flex items-baseline gap-2 px-3 py-1">
            <span className="min-w-0 flex-1" aria-hidden="true" />
            <span className="w-[88px] shrink-0 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              vs last year
            </span>
          </div>
          {rows.map(({ m, value }) => {
            const mom = m.momKey ? formatChange(zipData[m.momKey] as number | null, m.momFormat) : null;
            const yoy = m.yoyKey ? formatChange(zipData[m.yoyKey] as number | null, m.yoyFormat) : null;
            const change = (mom && !mom.isZero) ? mom : (yoy && !yoy.isZero) ? yoy : null;
            const changeIsYoy = !(mom && !mom.isZero);
            const isPainted = m.key === highlight;

            return (
              <div
                key={m.key as string}
                className={`flex items-baseline gap-2 px-3 py-2 ${isPainted ? "bg-primary/5" : ""}`}
              >
                <span
                  className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                  title={m.label}
                >
                  {m.label}
                </span>
                <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                  {formatMetricValue(value, m.format as FormatType)}
                </span>
                <span className="w-[88px] shrink-0 text-right">
                  {change && (
                    <Delta
                      change={change}
                      suffix={changeIsYoy ? "YoY" : "MoM"}
                      compact
                      showSuffix={!changeIsYoy}
                    />
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Delta({
  change, suffix, compact, showSuffix,
}: {
  change: { formatted: string; isPositive: boolean; isZero: boolean };
  suffix: string;
  compact?: boolean;
  /** Defaults to the inverse of `compact`: the hero has room for the period,
   *  a 32 px row does not. A compact row overrides this to mark the one
   *  metric whose change is NOT the column header's year-over-year. */
  showSuffix?: boolean;
}) {
  const Icon = change.isPositive ? TrendingUp : TrendingDown;
  const withSuffix = showSuffix ?? !compact;
  return (
    <span
      className={`inline-flex items-center gap-0.5 tabular-nums ${compact ? "text-[11px]" : "text-xs"} ${
        change.isPositive ? "text-emerald-600 dark:text-emerald-500" : "text-rose-600 dark:text-rose-500"
      }`}
      title={`${change.formatted} ${suffix === "YoY" ? "vs last year" : "vs last month"}`}
    >
      <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
      {change.formatted}
      {withSuffix && <span className="ml-0.5 text-muted-foreground font-normal">{suffix}</span>}
    </span>
  );
}
