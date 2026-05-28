import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { ZipData } from "../map/types";
import { Download, FileImage, Search, X, Settings2, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PrintStage, PrintStageRef, EXPORT_CANVAS_W, EXPORT_CANVAS_H, ATTRIBUTION_TEXT, ATTRIBUTION_FONT, ATTRIBUTION_BASELINE_Y, ATTRIBUTION_RIGHT_X } from "./PrintStage";
import { cn } from "@/lib/utils";
import { jsPDF, jsPDFOptions } from "jspdf";
import { toast } from "@/hooks/use-toast";
import { trackError } from "@/lib/analytics";
import { getStateName } from "../map/utils";

export interface ExportOptions {
  regionScope: "national" | "state" | "metro";
  selectedState?: string;
  selectedMetro?: string;
  fileFormat: "png" | "pdf";
  includeLegend: boolean;
  includeTitle: boolean;
}

interface ExportSidebarProps {
  allZipData: Record<string, ZipData>;
  selectedMetric: string;
  onClose: () => void;
}

export function ExportSidebar({ allZipData, selectedMetric, onClose }: ExportSidebarProps) {
  const [regionScope, setRegionScope] = useState<"national" | "state" | "metro">("national");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedMetro, setSelectedMetro] = useState<string>("");

  // Metro Search States
  const [metroSearch, setMetroSearch] = useState<string>("");
  const [debouncedMetroSearch, setDebouncedMetroSearch] = useState<string>("");
  const [isMetroListOpen, setIsMetroListOpen] = useState(false);
  const metroContainerRef = useRef<HTMLDivElement>(null);

  const [fileFormat, setFileFormat] = useState<"png" | "pdf">("png");
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [showCities, setShowCities] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  const printStageRef = useRef<PrintStageRef>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMetroSearch(metroSearch), 150);
    return () => clearTimeout(timer);
  }, [metroSearch]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (metroContainerRef.current && !metroContainerRef.current.contains(event.target as Node)) {
        setIsMetroListOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    setIsMapReady(false);
  }, [regionScope, selectedState, selectedMetro, selectedMetric, showCities]);

  const { availableStates, filteredMetros } = useMemo(() => {
    if (Object.keys(allZipData).length === 0) return { availableStates: [], filteredMetros: [] };

    const stateSet = new Set<string>();
    const metroSet = new Set<string>();

    for (const zip of Object.values(allZipData)) {
      const metricValue = zip[selectedMetric as keyof ZipData];
      const hasData = metricValue !== null && metricValue !== undefined;

      if (hasData) {
        if (zip.state) stateSet.add(zip.state);
        if (zip.metro) metroSet.add(zip.metro);
      }
    }

    const states = Array.from(stateSet)
      .map(code => ({ code, name: getStateName(code) }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const metros = Array.from(metroSet);

    let filtered = metros;
    if (debouncedMetroSearch) {
      const query = debouncedMetroSearch.toLowerCase();
      filtered = metros.filter(m => m.toLowerCase().includes(query));
      filtered.sort((a, b) => {
        const aLower = a.toLowerCase();
        const bLower = b.toLowerCase();
        const indexA = aLower.indexOf(query);
        const indexB = bLower.indexOf(query);
        if (indexA !== indexB) return indexA - indexB;
        return a.localeCompare(b);
      });
    } else {
      filtered.sort((a, b) => a.localeCompare(b));
    }

    return { availableStates: states, filteredMetros: filtered };
  }, [allZipData, selectedMetric, debouncedMetroSearch]);

  const hasValidSelection = useMemo(() => {
    if (regionScope === 'national') return true;
    if (regionScope === 'state' && selectedState) return true;
    if (regionScope === 'metro' && selectedMetro) return true;
    return false;
  }, [regionScope, selectedState, selectedMetro]);

  const filteredData = useMemo(() => {
    if (!hasValidSelection) return [];
    if (Object.keys(allZipData).length === 0) return [];

    return Object.values(allZipData).filter(zip => {
      if (regionScope === 'state' && selectedState) return zip.state === selectedState;
      if (regionScope === 'metro' && selectedMetro) return zip.metro === selectedMetro;
      return true;
    });
  }, [allZipData, regionScope, selectedState, selectedMetro, hasValidSelection]);

  const regionName = useMemo(() => {
    if (regionScope === 'state') return getStateName(selectedState) || "Select a state";
    if (regionScope === 'metro') return selectedMetro || "Select a metro area";
    return "United States";
  }, [regionScope, selectedState, selectedMetro]);

  const isExportDisabled = () => {
    if (isExporting) return true;
    if (!isMapReady) return true;
    if (!hasValidSelection) return true;
    if (filteredData.length === 0) return true;
    return false;
  };

  const getButtonText = () => {
    if (isExporting) return "Exporting...";
    if (!hasValidSelection) {
      if (regionScope === 'state') return "Select a state";
      if (regionScope === 'metro') return "Select a metro";
    }
    if (!isMapReady && filteredData.length > 0) return "Rendering...";
    return `Export ${fileFormat.toUpperCase()}`;
  };

  const handleExport = useCallback(async () => {
    if (!printStageRef.current) return;

    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "map_export_click",
      export_settings: {
        format: fileFormat,
        metric: selectedMetric,
        scope: regionScope,
        region_name: regionName,
        include_legend: includeLegend,
        include_title: includeTitle,
      },
    });

    setIsExporting(true);

    try {
      const canvas = await printStageRef.current.exportToCanvas();
      const safeRegionName = regionName.replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();

      if (fileFormat === "png") {
        const link = document.createElement("a");
        link.download = `Domapus-${selectedMetric}-${safeRegionName}.png`;
        link.href = canvas.toDataURL("image/png", 1.0);
        link.click();
      } else {
        const imgData = canvas.toDataURL("image/png", 1.0);
        const MARGIN = 4;
        const options: jsPDFOptions = { orientation: "l", unit: "mm", format: "a4" };
        const pdf = new jsPDF(options);

        pdf.setProperties({
          title: `Domapus Export - ${selectedMetric}`,
          subject: `Real Estate Data for ${regionName}`,
          creator: "Domapus (https://jasperwchen.github.io/Domapus/)",
        });

        const pdfWidth = pdf.internal.pageSize.getWidth();
        const pdfHeight = pdf.internal.pageSize.getHeight();
        const usableWidth = pdfWidth - 2 * MARGIN;
        const usableHeight = pdfHeight - 2 * MARGIN;
        const imgAspect = canvas.width / canvas.height;

        let drawWidth: number, drawHeight: number;
        if (usableWidth / usableHeight > imgAspect) {
          drawHeight = usableHeight;
          drawWidth = drawHeight * imgAspect;
        } else {
          drawWidth = usableWidth;
          drawHeight = drawWidth / imgAspect;
        }

        const offsetX = MARGIN + (usableWidth - drawWidth) / 2;
        const offsetY = MARGIN + (usableHeight - drawHeight) / 2;

        pdf.addImage(imgData, "PNG", offsetX, offsetY, drawWidth, drawHeight);

        const tmpCtx = document.createElement("canvas").getContext("2d")!;
        tmpCtx.font = ATTRIBUTION_FONT;
        const metrics = tmpCtx.measureText(ATTRIBUTION_TEXT);
        const canvasTextRight = ATTRIBUTION_RIGHT_X;
        const canvasTextLeft = canvasTextRight - metrics.width;
        const canvasTextTop = ATTRIBUTION_BASELINE_Y - (metrics.actualBoundingBoxAscent ?? 24);
        const canvasTextBottom = ATTRIBUTION_BASELINE_Y + (metrics.actualBoundingBoxDescent ?? 5);
        const scaleX = drawWidth / EXPORT_CANVAS_W;
        const scaleY = drawHeight / EXPORT_CANVAS_H;
        const attrX = offsetX + (canvasTextLeft - 2) * scaleX;
        const attrY = offsetY + (canvasTextTop - 2) * scaleY;
        const attrW = (metrics.width + 4) * scaleX;
        const attrH = (canvasTextBottom - canvasTextTop + 4) * scaleY;
        pdf.link(attrX, attrY, attrW, attrH, { url: "https://jasperwchen.github.io/Domapus/" });

        pdf.save(`Domapus-${selectedMetric}-${safeRegionName}.pdf`);
      }

      toast({ title: "Export Complete", description: "Your map has been downloaded.", duration: 5000 });
    } catch (error: unknown) {
      console.error("Export failed:", error);
      trackError("export_failed", error instanceof Error ? error.message : "Unknown export error");
      toast({ title: "Export Failed", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [fileFormat, selectedMetric, regionScope, regionName, includeLegend, includeTitle]);

  const selectMetro = (metroName: string) => {
    setSelectedMetro(metroName);
    setMetroSearch(metroName);
    setIsMetroListOpen(false);
  };

  const clearMetroSelection = () => {
    setSelectedMetro("");
    setMetroSearch("");
    setDebouncedMetroSearch("");
    setIsMetroListOpen(true);
  };

  return (
    <div className="fixed inset-0 bg-background z-50 flex flex-col md:flex-row">
      {/* Preview Area (top on mobile) */}
      <div className="order-1 md:order-2 flex-1 md:p-6 overflow-hidden flex flex-col bg-muted/30 min-h-[52vh] md:min-h-0">
        <div className="flex-1 flex items-center justify-center min-h-0 w-full">
          {hasValidSelection ? (
            <PrintStage
              ref={printStageRef}
              filteredData={filteredData}
              selectedMetric={selectedMetric}
              regionScope={regionScope}
              regionName={regionName}
              includeLegend={includeLegend}
              includeTitle={includeTitle}
              showCities={showCities}
              onReady={() => setIsMapReady(true)}
            />
          ) : (
            <div className="bg-white/50 border border-dashed rounded-lg w-full h-full flex items-center justify-center text-muted-foreground text-sm">
              {regionScope === 'state' ? "Select a state to preview" : "Select a metro area to preview"}
            </div>
          )}
        </div>
      </div>

      {/* Settings (bottom on mobile) */}
      <div className="order-2 md:order-1 w-full md:w-80 bg-background border-t md:border-t-0 md:border-r h-auto md:h-full shadow-xl flex flex-col max-h-[48vh] md:max-h-full">
        <div className="p-3 md:p-4 space-y-3 md:space-y-4 flex-1 overflow-y-auto">
          <div className="flex items-center gap-2">
            <Download className="h-4 w-4 text-primary" />
            <h2 className="text-base font-semibold">Export Settings</h2>
          </div>

          <div className="p-2 md:p-3 rounded-md border bg-muted/20">
            <div className="grid grid-cols-3 md:grid-cols-1 gap-3 md:gap-4">
              <div className="space-y-2 md:space-y-3">
                <div className="flex items-center gap-2 text-xs md:text-sm font-medium">
                  <Microscope className="h-3.5 w-3.5" />
                  <span>Region</span>
                </div>
                <RadioGroup value={regionScope} onValueChange={(v) => setRegionScope(v as "national" | "state" | "metro")} className="space-y-1.5 md:space-y-2">
                  <div className="flex items-center space-x-2"><RadioGroupItem value="national" id="r-national" /><Label htmlFor="r-national" className="text-xs md:text-sm">National</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="state" id="r-state" /><Label htmlFor="r-state" className="text-xs md:text-sm">State</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="metro" id="r-metro" /><Label htmlFor="r-metro" className="text-xs md:text-sm">Metro</Label></div>
                </RadioGroup>

                {regionScope === 'state' && (
                  <Select value={selectedState} onValueChange={setSelectedState}>
                    <SelectTrigger className="h-8 md:h-9"><SelectValue placeholder="Select a state" /></SelectTrigger>
                    <SelectContent>{availableStates.map(state => (<SelectItem key={state.code} value={state.code}>{state.name}</SelectItem>))}</SelectContent>
                  </Select>
                )}

                {regionScope === 'metro' && (
                  <div className="space-y-2 relative" ref={metroContainerRef}>
                    <div className="relative">
                      <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        placeholder="Type to search metros..."
                        value={metroSearch}
                        onChange={(e) => {
                          setMetroSearch(e.target.value);
                          setIsMetroListOpen(true);
                          if (selectedMetro && e.target.value !== selectedMetro) setSelectedMetro("");
                        }}
                        onFocus={(e) => {
                          setIsMetroListOpen(true);
                          const target = e.currentTarget;
                          setTimeout(() => target.select(), 0);
                        }}
                        className="pl-8 h-8 md:h-9 pr-8 text-xs md:text-sm"
                      />
                      {metroSearch && (
                        <button onClick={clearMetroSelection} className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground">
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {isMetroListOpen && (
                      <div className="absolute z-10 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md max-h-[250px] overflow-y-auto">
                        {filteredMetros.length > 0 ? (
                          <div className="p-1">
                            {filteredMetros.map((m) => (
                              <div
                                key={m}
                                onClick={() => selectMetro(m)}
                                className={cn(
                                  "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                                  selectedMetro === m && "bg-accent text-accent-foreground font-medium"
                                )}
                              >
                                {m}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="py-6 text-center text-sm text-muted-foreground">No metro areas found.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="space-y-2 md:space-y-3">
                <div className="flex items-center gap-2 text-xs md:text-sm font-medium">
                  <FileImage className="h-3.5 w-3.5" />
                  <span>File</span>
                </div>
                <RadioGroup value={fileFormat} onValueChange={(v) => setFileFormat(v as "png" | "pdf")} className="space-y-1.5 md:space-y-2">
                  <div className="flex items-center space-x-2"><RadioGroupItem value="png" id="r-png" /><Label htmlFor="r-png" className="text-xs md:text-sm">PNG</Label></div>
                  <div className="flex items-center space-x-2"><RadioGroupItem value="pdf" id="r-pdf" /><Label htmlFor="r-pdf" className="text-xs md:text-sm">PDF</Label></div>
                </RadioGroup>
              </div>

              <div className="space-y-2 md:space-y-3">
                <div className="flex items-center gap-2 text-xs md:text-sm font-medium">
                  <Settings2 className="h-3.5 w-3.5" />
                  <span>Customization</span>
                </div>
                <div className="space-y-1.5 md:space-y-2">
                  <div className="flex items-center space-x-2"><Checkbox id="c-title" checked={includeTitle} onCheckedChange={(c) => setIncludeTitle(c === true)} /><Label htmlFor="c-title" className="text-xs md:text-sm">Include Title</Label></div>
                  <div className="flex items-center space-x-2"><Checkbox id="c-legend" checked={includeLegend} onCheckedChange={(c) => setIncludeLegend(c === true)} /><Label htmlFor="c-legend" className="text-xs md:text-sm">Include Legend</Label></div>
                  <div className="flex items-center space-x-2"><Checkbox id="c-cities" checked={showCities} onCheckedChange={(c) => setShowCities(c === true)} /><Label htmlFor="c-cities" className="text-xs md:text-sm">Show Cities</Label></div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 md:p-4 space-y-2 border-t bg-background">
          <Button id="btn-map-export" onClick={handleExport} disabled={isExportDisabled()} className="w-full" size="default">
            {(isExporting || (!isMapReady && hasValidSelection && filteredData.length > 0)) && (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
            )}
            {!isExporting && hasValidSelection && filteredData.length > 0 && isMapReady && (
              <Download className="h-4 w-4 mr-2" />
            )}
            {getButtonText()}
          </Button>
          <Button onClick={onClose} variant="outline" className="w-full" disabled={isExporting}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}