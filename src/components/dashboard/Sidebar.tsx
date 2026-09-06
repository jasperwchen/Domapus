import { useState, lazy, Suspense, useEffect, useRef } from "react";
import { X, ArrowLeft, TrendingUp, TrendingDown, BarChart3, MapPin, Building, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { ZipData } from "./map/types";
import type { ZipTable } from "@/lib/zip-table";
import { Badge } from "@/components/ui/badge";
import { formatMetricValue, formatChange, METRIC_DEFINITIONS, FormatType, getStateName } from "./map/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { formatRedfinWindow } from "@/lib/data-dates";

const ZipComparison = lazy(() => import("./ZipComparison").then(m => ({ default: m.ZipComparison })));

interface SidebarProps {
  isOpen: boolean;
  zipData: ZipData | null;
  store: ZipTable | null;
  onClose: () => void;
}

export function Sidebar({ isOpen, zipData, store, onClose }: SidebarProps) {
  const [showComparison, setShowComparison] = useState(false);
  const isMobile = useIsMobile();
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Focus management: move focus to heading when sidebar opens
  useEffect(() => {
    if (isOpen && zipData && headingRef.current) {
      headingRef.current.focus();
    }
  }, [isOpen, zipData]);

  if (!isOpen || !zipData) return null;

  // Validate zipData has required fields
  if (!zipData.zipCode) {
    console.warn("[Sidebar] Invalid zipData: missing zipCode", zipData);
    return null;
  }

  // The list of all metrics to display for a single ZIP code
  const allMetrics = Object.values(METRIC_DEFINITIONS)
    .map(metric => ({
      ...metric,
      value: zipData[metric.key as keyof ZipData] as number | null
    }))
    .filter(metric => metric.value !== null && metric.value !== undefined && !isNaN(metric.value));

  return (
    <div className={`bg-dashboard-panel border-r border-dashboard-border shadow-lg flex flex-col h-full ${isMobile ? "w-full rounded-none" : "w-96 rounded-none"}`}>
      {/* Static Top Banner */}
      <div className="flex-none px-4 pb-1 border-b border-dashboard-border bg-dashboard-panel flex items-center justify-between z-10 shadow-sm">
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-primary" />
          <h2 
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-bold tracking-tight text-foreground outline-none"
          >
            {zipData.zipCode || "N/A"}
          </h2>
          {showComparison && (
            <Badge variant="secondary" className="ml-2 bg-primary/10 text-primary border-none text-[10px] uppercase tracking-wider font-bold">
              Compare
            </Badge>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className={`text-muted-foreground hover:text-foreground transition-colors ${isMobile ? 'h-11 w-11' : 'h-8 w-8'}`}
          onClick={onClose}
          aria-label="Close sidebar"
        >
          <X className={`${isMobile ? 'h-8 w-8' : 'h-7 w-7'}`} />
        </Button>
      </div>

      <div className="flex flex-col flex-1 overflow-hidden min-h-0" aria-live="polite">
        {showComparison ? (
          <div className="flex-1 overflow-y-auto p-4">
            <Suspense fallback={
              <div className="flex items-center justify-center h-32">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            }>
              <ZipComparison currentZip={zipData} store={store} />
            </Suspense>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            <div className="flex-none pt-1 pb-2">
              <div className="space-y-1 px-1">
                {[
                  { label: "City", value: zipData.city },
                  { label: "County", value: zipData.county },
                  { label: "Metro", value: zipData.metro },
                  { label: "State", value: getStateName(zipData.state) },
                  { label: "Redfin period", value: formatRedfinWindow(zipData.period_end) },
                ].map((item, i) => (
                  <div key={i} className="flex justify-between items-baseline">
                    <span className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">
                      {item.label}
                    </span>
                    <span className="text-xs font-medium text-foreground tabular-nums">
                      {item.value || "—"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <h3 className="text-sm font-medium pt-1 flex items-center"><Building className="h-4 w-4 mr-2" />Market Data</h3>
            <div className="space-y-3">
              {allMetrics.map((metric, index) => {
                // Only ZHVI has a MoM. Redfin publishes none at ZIP level.
                const momChange = metric.momKey
                  ? formatChange(zipData[metric.momKey] as number | null, metric.momFormat)
                  : null;
                // The change format is per metric: median_dom moves in days and
                // months_of_supply in months, not percent.
                const yoyChange = metric.yoyKey
                  ? formatChange(zipData[metric.yoyKey] as number | null, metric.yoyFormat)
                  : null;
                return (
                  <Card key={index}><CardContent className="p-4"><div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground">{metric.label}</p>
                    <p className="text-xl font-bold">{formatMetricValue(metric.value, metric.format as FormatType)}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {momChange && !momChange.isZero && (<span className={`flex items-center ${momChange.isPositive ? "text-green-600" : "text-red-600"}`}>{momChange.isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}{momChange.formatted} vs last month</span>)}
                      {yoyChange && !yoyChange.isZero && (<span className={`flex items-center ${yoyChange.isPositive ? "text-green-600" : "text-red-600"}`}>{yoyChange.isPositive ? <TrendingUp className="h-3 w-3 mr-1" /> : <TrendingDown className="h-3 w-3 mr-1" />}{yoyChange.formatted} vs last year</span>)}
                    </div>
                  </div></CardContent></Card>
                );
              })}
            </div>
          </div>
        )}

        {/* Static Bottom Banner */}
        <div className="flex-none p-4 border-t border-dashboard-border bg-dashboard-panel shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
          <Button
            variant={showComparison ? "outline" : "default"}
            className="w-full shadow-sm"
            onClick={() => setShowComparison(!showComparison)}
          >
            {showComparison ? (
              <div className="flex items-center">
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Details
              </div>
            ) : (
              <div className="flex items-center">
                <BarChart3 className="h-4 w-4 mr-2" />
                Compare ZIP Codes
              </div>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
