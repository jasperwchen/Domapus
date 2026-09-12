import { useMemo } from "react";
import { Link, useLocation } from "react-router-dom";
import { useIsMobile } from "@/hooks/use-mobile";
import { HelpCircle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getMetricLabel } from "@/lib/metrics";
import { formatLegendValue, tickAt } from "@/lib/legend-format";
import { computeQuantiles } from "@/lib/quantiles";
import { CHOROPLETH_COLORS, CHOROPLETH_GRADIENT_STOPS, NO_DATA_COLOR } from "@/lib/choropleth";
import { OUTLIER_COLORS } from "@/lib/choropleth-painter";

interface LegendProps {
  selectedMetric: string;
  metricValues: number[];
  /** The SAME break values the map is painting, straight from the live
   *  ClassSource. The legend used to compute its own quantiles from its own
   *  sample, so it could describe a scale the map was not using. */
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
}

export function Legend({
  selectedMetric, metricValues, breaks, autoScale, onAutoScaleChange,
  showLisa, onShowLisaChange, reliability, outliers,
}: LegendProps) {
  const isMobile = useIsMobile();
  const { search } = useLocation();

  const legendDisplay = useMemo(() => {
    if (!metricValues || metricValues.length === 0) {
      return { min: "N/A", mid: "N/A", max: "N/A" };
    }

    // 5th, 50th, 95th percentiles for robust min/mid/max
    const [min, mid, max] = computeQuantiles(metricValues, [0.05, 0.5, 0.95]);

    return {
      min: formatLegendValue(min, selectedMetric),
      mid: formatLegendValue(mid, selectedMetric),
      max: formatLegendValue(max, selectedMetric),
    };
  }, [metricValues, selectedMetric]);

  const gradient = `linear-gradient(to right, ${CHOROPLETH_GRADIENT_STOPS})`;
  const verticalGradient = `linear-gradient(to top, ${CHOROPLETH_GRADIENT_STOPS})`;

  // One band per painted class, labelled with the map's own break values. The
  // bands are SEAMLESS but hard-edged: at 14 classes the strip reads as a ramp,
  // and every pixel of it is a colour some ZIP is actually painted. Interpolating
  // between them would be the easier way to get that look and would put colours
  // in the key that the map can never produce.
  const hasBreaks = !!breaks && breaks.length === CHOROPLETH_COLORS.length - 1;

  // Labels are a sample of the boundaries, not all of them. 13 values of 5-7
  // characters across a 256 px panel is ~20 px each at 10 px type; they would
  // overlap into noise. A choropleth key exists to give a sense of scale, not to
  // be a lookup table — the exact range of any band is on its own tooltip, and
  // the value of any ZIP is one hover away on the map.
  //
  // Five on desktop, three on the 80 px mobile strip. Both are spread evenly
  // across the boundary list, so with 13 boundaries the desktop ticks land on
  // 0, 3, 6, 9 and 12 — every 21.4% of the strip, with the middle one at exactly
  // half. Derived from the count rather than written down, so changing CLASSES
  // does not silently label the wrong boundaries.
  const ticks = useMemo(
    () => (hasBreaks ? tickAt(breaks!, 5, selectedMetric) : null),
    [hasBreaks, breaks, selectedMetric],
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
          {/* Each label sits at the height of the boundary it names, not at the
              top/middle/bottom of the strip. The old markup spread three
              PERCENTILES of the value list evenly down the bar, which described a
              scale the map was not painting — the same second-authority problem
              the desktop key was fixed for. */}
          {mobileTicks ? (
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
          ) : (
            <div className="flex flex-col justify-between text-[11px] font-medium text-muted-foreground py-0.5">
              <span className="text-foreground">{legendDisplay.max}</span>
              <span>{legendDisplay.mid}</span>
              <span>{legendDisplay.min}</span>
            </div>
          )}
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
            <div className="flex" aria-hidden="true">
              {CHOROPLETH_COLORS.map((c, i) => (
                <div
                  key={c + i}
                  className="h-4 flex-1 first:rounded-l-sm last:rounded-r-sm"
                  style={{ background: c }}
                  title={
                    i === 0
                      ? `below ${formatLegendValue(breaks![0], selectedMetric)}`
                      : i === CHOROPLETH_COLORS.length - 1
                        ? `${formatLegendValue(breaks![breaks!.length - 1], selectedMetric)} and above`
                        : `${formatLegendValue(breaks![i - 1], selectedMetric)} to ${formatLegendValue(breaks![i], selectedMetric)}`
                  }
                />
              ))}
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
          <>
            <div
              className="h-4 rounded-sm border border-border"
              style={{ background: gradient }}
              aria-hidden="true"
            />
            <div className="flex justify-between text-xs text-muted-foreground font-medium">
              <span>{legendDisplay.min}</span>
              <span>{legendDisplay.mid}</span>
              <span>{legendDisplay.max}</span>
            </div>
          </>
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

        {/* The reliability channel is no longer a fill treatment. Fading tier 0
            moved lightness on a ramp whose meaning IS lightness — measured at up
            to 3.90 class steps of error on the darkest class — and it fell on
            rural ZIPs, which the pipeline separately measures as genuinely
            cheaper. Two errors, same direction. The number now lives where a
            number can be read: the hover popup and the detail panel. This line
            says the scale is still cut on the rankable subset, because that part
            of the selection effect is real and unchanged. */}
        {reliability && (
          <p className="text-[11px] leading-snug text-muted-foreground pt-0.5">
            {/* Same tab, like every other route link. This used to open a new
                one to protect the reader's map state; the query string carries
                metric, ZIP and viewport now, so returning restores all of it. */}
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

/** A checkbox, its label and its explanation as one row. Three copies of this
 *  markup drifted apart; the tooltip on one was 180 px wide and on another 220. */
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
