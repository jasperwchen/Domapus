import { useMemo } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { Checkbox } from "@/components/ui/checkbox";
import { HelpCircle, Loader2 } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { METRICS, getMetricLabel } from "@/lib/metrics";
import { computeQuantiles } from "@/lib/quantiles";
import { CHOROPLETH_COLORS, CHOROPLETH_GRADIENT_STOPS, NO_DATA_COLOR } from "@/lib/choropleth";

interface LegendProps {
  selectedMetric: string;
  metricValues: number[];
  /** The SAME break values the map is painting, straight from the live
   *  ClassSource. The legend used to compute its own quantiles from its own
   *  sample, so it could describe a scale the map was not using. */
  breaks?: readonly number[] | null;
  autoScale?: boolean;
  onAutoScaleChange?: (value: boolean) => void;
  isIndexReady?: boolean;
}

// Formatted from the metric registry rather than by sniffing the key name. The
// old substring test read "months_of_supply" as neither price nor ratio and fell
// through to a raw number, and would have read any future "*_price_ratio" as a
// price because "price" matched first.
function formatLegendValue(value: number, metric: string): string {
  switch (METRICS[metric]?.format) {
    case "price":
      return value >= 1000 ? `$${(value / 1000).toFixed(0)}k` : `$${value.toFixed(0)}`;
    case "percent":
      return `${value.toFixed(1)}%`;
    case "months":
      return value.toFixed(1);
    case "days":
      return `${Math.round(value)}d`;
    default:
      return value.toLocaleString();
  }
}

export function Legend({
  selectedMetric, metricValues, breaks, autoScale, onAutoScaleChange, isIndexReady = true,
}: LegendProps) {
  const isMobile = useIsMobile();

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

  // Discrete swatches, one per painted class, labelled with the map's own break
  // values. A continuous gradient implies a continuum the map does not paint.
  const hasBreaks = !!breaks && breaks.length === CHOROPLETH_COLORS.length - 1;
  const classLabels = hasBreaks
    ? breaks.map((b) => formatLegendValue(b, selectedMetric))
    : null;

  // Mobile
  if (isMobile) {
    return (
      <div className="bg-card/95 backdrop-blur-sm shadow-lg border border-border rounded-lg p-3 w-[155px]">
        {!isIndexReady && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground mb-2">
            <Loader2 className="h-3 w-3 animate-spin" />
            <span>Optimizing search...</span>
          </div>
        )}

        <div className="flex items-stretch gap-2 h-20">
          <div
            className="w-3 rounded-sm border border-border"
            style={{ background: verticalGradient }}
            aria-hidden="true"
          />
          <div className="flex flex-col justify-between text-[11px] font-medium text-muted-foreground py-0.5">
            <span className="text-foreground">{legendDisplay.max}</span>
            <span>{legendDisplay.mid}</span>
            <span>{legendDisplay.min}</span>
          </div>
        </div>

        {onAutoScaleChange && (
          <div className="flex items-center gap-2 my-3">
            <Checkbox
              id="legend-auto-scale-mobile"
              checked={autoScale}
              onCheckedChange={(c) => onAutoScaleChange(c === true)}
              className="h-3.5 w-3.5"
            />
            <label
              htmlFor="legend-auto-scale-mobile"
              className="text-[10px] font-medium leading-none cursor-pointer select-none text-muted-foreground"
            >
              Auto Scale
            </label>
          </div>
        )}

        <div className="mt-3 text-[10px] text-muted-foreground text-center italic">
          Tap a ZIP code for details
        </div>
      </div>
    );
  }

  // Desktop / default
  return (
    <div className="border border-border rounded-lg p-4 w-full max-w-xs bg-card/95 backdrop-blur-sm shadow-xl">
      <h3 className="text-sm font-semibold mb-3 text-foreground">
        {getMetricLabel(selectedMetric)}
      </h3>

      {!isIndexReady && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground mb-3 px-1">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Optimizing search...</span>
        </div>
      )}

      {onAutoScaleChange && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <Checkbox
            id="legend-auto-scale"
            checked={autoScale}
            onCheckedChange={(c) => onAutoScaleChange(c === true)}
            className="h-3.5 w-3.5"
          />
          <label
            htmlFor="legend-auto-scale"
            className="text-[10px] font-medium leading-none cursor-pointer select-none text-muted-foreground hover:text-foreground transition-colors"
          >
            Adjust contrast to view
          </label>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <HelpCircle className="h-3 w-3 text-muted-foreground/70 cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="top">
                <p className="w-[180px] text-xs">
                  When enabled, the color scale automatically adjusts to the range of values currently visible on the map.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      )}

      <div className="space-y-2">
        {hasBreaks ? (
          <>
            <div className="flex" aria-hidden="true">
              {CHOROPLETH_COLORS.map((c, i) => (
                <div
                  key={c + i}
                  className="h-4 flex-1 border-y border-border first:rounded-l-md first:border-l last:rounded-r-md last:border-r"
                  style={{ background: c }}
                />
              ))}
            </div>
            <div className="flex text-[10px] text-muted-foreground font-semibold tabular-nums">
              {classLabels!.map((label, i) => (
                <span key={i} className="flex-1 text-right -mr-2 last:mr-0">
                  {label}
                </span>
              ))}
              <span className="flex-1" />
            </div>
          </>
        ) : (
          <>
            <div
              className="h-4 rounded-md border border-border"
              style={{ background: gradient }}
              aria-hidden="true"
            />
            <div className="flex justify-between text-xs text-muted-foreground font-semibold">
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
        <div className="flex items-center gap-2 pt-1 text-[10px] text-muted-foreground">
          <span
            className="inline-block h-3 w-3 rounded-sm border border-border"
            style={{ background: NO_DATA_COLOR }}
            aria-hidden="true"
          />
          <span>No data reported</span>
        </div>
      </div>

    </div>
  );
}
