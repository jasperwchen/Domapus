import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getMetricLabel } from "@/lib/metrics";
import { formatLegendValue, tickAt } from "@/lib/legend-format";
import { CHOROPLETH_COLORS, CHOROPLETH_GRADIENT_STOPS, NO_DATA_COLOR } from "@/lib/choropleth";
import { OUTLIER_COLORS } from "@/lib/choropleth-painter";

interface LegendProps {
  selectedMetric: string;
  /** The SAME break values the map is painting, straight from the live ClassSource. A
   *  legend that computes its own can describe a scale the map is not using. */
  breaks?: readonly number[] | null;
  autoScale?: boolean;
  onAutoScaleChange?: (value: boolean) => void;
  showLisa?: boolean;
  onShowLisaChange?: (value: boolean) => void;
  /** How many ZIPs rest on too few sales to rank, and what the threshold is.
   *  Null until the manifest lands. */
  reliability?: { rankableShare: number; impliedN: number } | null;
  /** How many ZIPs break their neighbourhood's price pattern. Null until the
   *  manifest lands, and absent entirely if the spatial stage did not run. */
  outliers?: { total: number } | null;
  /** Published ZIP count per class; an empty class draws as a notch. Null whenever the counts
   *  do not describe the breaks on screen (auto-scale). */
  classCounts?: readonly number[] | null;
}

export function Legend({
  selectedMetric, breaks, autoScale, onAutoScaleChange,
  showLisa, onShowLisaChange, reliability, outliers, classCounts,
}: LegendProps) {
  const isMobile = useIsMobile();
  const { search } = useLocation();

  const gradient = `linear-gradient(to right, ${CHOROPLETH_GRADIENT_STOPS})`;
  const verticalGradient = `linear-gradient(to top, ${CHOROPLETH_GRADIENT_STOPS})`;

  // One hard-edged band per class, so the key shows only colours the map can paint.
  const hasBreaks = !!breaks && breaks.length === CHOROPLETH_COLORS.length - 1;

  // Label a sample of boundaries (5 desktop, 3 mobile); 13 labels would overlap. Each band's
  // exact range is in its tooltip.
  const ticks = useMemo(
    () => (hasBreaks ? tickAt(breaks!, 5, selectedMetric) : null),
    [hasBreaks, breaks, selectedMetric],
  );

  // Ties can leave a class empty (e.g. homes_sold's first edge is 1.0 and no ZIP reports
  // under one sale). The break is right; the key marks the unused swatch.
  const isEmptyClass = useMemo(() => {
    const n = CHOROPLETH_COLORS.length;
    if (!classCounts || classCounts.length !== n) return () => false;
    return (i: number) => classCounts[i] === 0;
  }, [classCounts]);
  const emptyCount = useMemo(
    () => CHOROPLETH_COLORS.reduce((n, _, i) => n + (isEmptyClass(i) ? 1 : 0), 0),
    [isEmptyClass],
  );
  const mobileTicks = useMemo(
    () => (hasBreaks ? tickAt(breaks!, 3, selectedMetric) : null),
    [hasBreaks, breaks, selectedMetric],
  );

  // Mobile
  if (isMobile) {
    return (
      <div className="bg-card/95 backdrop-blur-sm shadow-lg border border-border rounded-lg p-3 w-[155px]">
        <div className="flex items-stretch gap-2 h-20">
          <div
            className="w-3 rounded-sm border border-border"
            style={{ background: verticalGradient }}
            aria-hidden="true"
          />
          {/* Each label sits at the height of the boundary it names, so the key
              describes the scale the map paints. */}
          {mobileTicks && (
            <div className="relative flex-1 text-[11px] font-medium tabular-nums text-muted-foreground">
              {mobileTicks.map(({ i, label }) => (
                <span
                  key={i}
                  className="absolute left-0 translate-y-1/2 whitespace-nowrap"
                  style={{ bottom: `${((i + 1) / CHOROPLETH_COLORS.length) * 100}%` }}
                >
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px] border border-border"
            style={{ background: NO_DATA_COLOR }}
            aria-hidden="true"
          />
          <span>No data reported</span>
        </div>

        {onAutoScaleChange && (
          <label className="mt-3 flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!autoScale}
              onChange={(e) => onAutoScaleChange(e.target.checked)}
              className="h-3.5 w-3.5 shrink-0 accent-primary"
            />
            <span className="text-[10px] font-medium leading-none text-muted-foreground">
              Adjust Contrast to View
            </span>
          </label>
        )}

        <div className="mt-3 text-[10px] text-muted-foreground text-center italic">
          Tap a ZIP code for details
        </div>
      </div>
    );
  }

  // Desktop / default
  return (
    <div className="border border-border rounded-lg px-4 py-3 w-full max-w-xs bg-card/95 backdrop-blur-sm shadow-xl">
      <h3 className="text-sm font-semibold mb-2.5 text-foreground leading-tight">
        {getMetricLabel(selectedMetric)}
      </h3>

      <div className="space-y-2">
        {hasBreaks ? (
          <>
            {/* An unused class keeps its slot and its colour but shrinks to a
                centred sliver, so the strip reads as a ramp with a notch in it.
                The width is deliberately untouched: the tick positions below are
                derived from (i + 1) / CLASSES, so dropping a band outright would
                silently move every label off the boundary it names.

                Height, not lightness. A faded swatch on a lightness ramp is the
                same channel the value is encoded in, which is why the reliability
                fade was taken off the map in the first place. */}
            <div className="flex items-center h-4" aria-hidden="true">
              {CHOROPLETH_COLORS.map((c, i) => {
                const empty = isEmptyClass(i);
                const range =
                  i === 0
                    ? `below ${formatLegendValue(breaks![0], selectedMetric)}`
                    : i === CHOROPLETH_COLORS.length - 1
                      ? `${formatLegendValue(breaks![breaks!.length - 1], selectedMetric)} and above`
                      : `${formatLegendValue(breaks![i - 1], selectedMetric)} to ${formatLegendValue(breaks![i], selectedMetric)}`;
                return (
                  <div
                    key={c + i}
                    className={`flex-1 first:rounded-l-sm last:rounded-r-sm ${empty ? "h-1" : "h-4"}`}
                    style={{ background: c }}
                    title={empty ? `${range} — no ZIP codes` : range}
                  />
                );
              })}
            </div>
            {/* Each tick sits under the boundary it marks: break i is the edge
                between swatch i and swatch i+1, so its centre is at
                (i + 1) / CLASSES across the strip. */}
            <div className="relative h-4">
              {ticks!.map(({ i, label }) => (
                <span
                  key={i}
                  className="absolute top-0 -translate-x-1/2 text-[10px] font-medium tabular-nums text-muted-foreground whitespace-nowrap"
                  style={{ left: `${((i + 1) / CHOROPLETH_COLORS.length) * 100}%` }}
                >
                  {label}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div
            className="h-4 rounded-sm border border-border"
            style={{ background: gradient }}
            aria-hidden="true"
          />
        )}

        {/* Three absence states, three channels, and they must not be conflated.
            "No data" is a ZCTA that IS drawn but that neither source reports —
            it gets a solid grey and this entry. "No polygon" (ocean, park) is
            the only legitimately blank state. Painting no-data transparent made
            it identical to both an absent polygon and a genuine zero. */}
        <div className="flex items-center gap-2 pt-0.5 text-[11px] text-muted-foreground">
          <span
            className="inline-block h-2.5 w-2.5 rounded-[2px] border border-border"
            style={{ background: NO_DATA_COLOR }}
            aria-hidden="true"
          />
          <span>No data reported</span>
        </div>

        {/* Says what the notch means. Without a caption a thin band reads as a
            rendering fault; with one it reads as information about the data. */}
        {emptyCount > 0 && (
          <p className="text-[11px] leading-snug text-muted-foreground">
            {emptyCount === 1 ? "One class holds" : `${emptyCount} classes hold`} no ZIP
            codes, drawn thin above. Ties in the data collapse the class.
          </p>
        )}
      </div>

      {/* DO NOT CHANGE TEXT */}
      <div className="mt-2.5 pt-2.5 border-t border-border/60 space-y-2">
        {onAutoScaleChange && (
          <ToggleRow
            id="legend-auto-scale"
            checked={!!autoScale}
            onChange={onAutoScaleChange}
            label="Adjust Contrast to View"
            help="Recalculates the color scale based only on ZIP codes currently visible, restoring contrast for regions of similar value."
          />
        )}

        {/* DO NOT CHANGE TEXT */}
        {onShowLisaChange && (
          <ToggleRow
            id="legend-outliers"
            checked={!!showLisa}
            onChange={onShowLisaChange}
            label={
              outliers
                ? `Highlight ${outliers.total} price outliers`
                : "Highlight price outliers"
            }
            help="Highlights ZIP codes where prices are unusually high or low compared to neighboring areas."
          />
        )}

        {showLisa && (
          <div className="space-y-1 pt-0.5" aria-live="polite">
            <OutlierKey
              color={OUTLIER_COLORS.LH}
              label="Cheap for its surroundings"
            />
            <OutlierKey
              color={OUTLIER_COLORS.HL}
              label="Expensive for its surroundings"
            />
          </div>
        )}

        {/* No reliability key: fading low-sample ZIPs moved lightness on a ramp that
            encodes value in lightness (up to 3.90 class steps of error), so the numbers
            live in the popup and the detail panel instead. */}
        {reliability && (
          <p className="text-[11px] leading-snug text-muted-foreground pt-0.5">
            {/* Same tab: the query string carries metric, ZIP and viewport, so
                returning restores the map. */}
            <Link
              to={`/methodology${search}`}
              className="underline underline-offset-2 hover:text-foreground"
            >
              Methodology
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}

/** A checkbox, its label and its explanation as one row. */
function ToggleRow({
  id, checked, onChange, label, help,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="checkbox"
        id={id}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary"
      />
      <label
        htmlFor={id}
        className="text-[11px] font-medium leading-none cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors"
      >
        {label}
      </label>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <HelpCircle className="h-3 w-3 shrink-0 text-muted-foreground/70 cursor-help" />
          </TooltipTrigger>
          <TooltipContent side="top">
            <p className="w-[240px] text-xs leading-snug">{help}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

function OutlierKey({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full border border-white shadow-[0_0_0_1px_rgba(0,0,0,0.25)]"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span>{label}</span>
    </div>
  );
}
