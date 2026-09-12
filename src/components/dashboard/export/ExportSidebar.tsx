import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { ZipData } from "../map/types";
import { Download, FileImage, Search, X, Settings2, Microscope } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { PrintStage, PrintStageRef, EXPORT_CANVAS_W, EXPORT_CANVAS_H } from "./PrintStage";
import { cn } from "@/lib/utils";
import { jsPDF, jsPDFOptions } from "jspdf";
import { toast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { trackError } from "@/lib/analytics";
import { getStateName } from "../map/utils";

const REPO_URL = "https://github.com/jasperwchen/Domapus";
/** Set once the reader has actually gone to the repo. After that the success
 *  toast goes back to being a plain confirmation — asking again is nagging. */
const STAR_CLICKED_KEY = "domapus:starred";
/** And at most one ask per page load even before that. */
let starAskedThisSession = false;

function starAlreadyClicked(): boolean {
  try { return localStorage.getItem(STAR_CLICKED_KEY) === "1"; }
  catch { return false; }
}

interface ExportSidebarProps {
  allZipData: Record<string, ZipData>;
  selectedMetric: string;
  /** The class boundaries the live map is painting, from the manifest. Without
   *  them there is no honest colour scale and the export is held back rather
   *  than invented — see PrintStage's `classesByZip`. */
  breaks: readonly number[] | null;
  onClose: () => void;
}

export function ExportSidebar({ allZipData, selectedMetric, breaks, onClose }: ExportSidebarProps) {
  const [regionScope, setRegionScope] = useState<"national" | "state" | "metro">("national");
  const [selectedState, setSelectedState] = useState<string>("");
  const [selectedMetro, setSelectedMetro] = useState<string>("");

  // Metro Search States
  const [metroSearch, setMetroSearch] = useState<string>("");
  const [debouncedMetroSearch, setDebouncedMetroSearch] = useState<string>("");
  const [isMetroListOpen, setIsMetroListOpen] = useState(false);
  /** Which suggestion Enter takes. Starts at the top of the list, so typing and
   *  pressing Enter picks the best match without reaching for the mouse. */
  const [activeMetro, setActiveMetro] = useState(0);
  const metroContainerRef = useRef<HTMLDivElement>(null);
  const metroListRef = useRef<HTMLDivElement>(null);

  const [fileFormat, setFileFormat] = useState<"png" | "pdf">("png");
  const [includeLegend, setIncludeLegend] = useState(true);
  const [includeTitle, setIncludeTitle] = useState(true);
  const [showCities, setShowCities] = useState(false);

  const [isExporting, setIsExporting] = useState(false);
  const [isMapReady, setIsMapReady] = useState(false);

  const printStageRef = useRef<PrintStageRef>(null);

  // Positron's place labels stack into noise at national extent, so the control
  // is disabled there rather than left to produce a bad export.
  const citiesAllowed = regionScope !== "national";
  const scaleAvailable = !!breaks && breaks.length > 0;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedMetroSearch(metroSearch), 150);
    return () => clearTimeout(timer);
  }, [metroSearch]);

  // A new query is a new list, so the highlight goes back to the top match.
  useEffect(() => { setActiveMetro(0); }, [debouncedMetroSearch]);

  useEffect(() => {
    if (!isMetroListOpen) return;
    const el = metroListRef.current?.querySelector<HTMLElement>(`[data-idx="${activeMetro}"]`);
    el?.scrollIntoView?.({ block: "nearest" });
  }, [activeMetro, isMetroListOpen]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (metroContainerRef.current && !metroContainerRef.current.contains(event.target as Node)) {
        setIsMetroListOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // A full-screen dialog that only closes through one button is a trap on the
  // way out; Escape closes it, except mid-export where the download is in flight.
  const isExportingRef = useRef(isExporting);
  isExportingRef.current = isExporting;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || isExportingRef.current) return;
      if (isMetroListOpen) { setIsMetroListOpen(false); return; }
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, isMetroListOpen]);

  // `showCities` is deliberately absent: it no longer rebuilds the maps, so the
  // preview never leaves the ready state when it changes.
  useEffect(() => {
    setIsMapReady(false);
  }, [regionScope, selectedState, selectedMetro, selectedMetric]);

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

  /** How much of the region this metric can actually colour. Shown so the reader
   *  finds out before exporting, not after. */
  const withData = useMemo(
    () => filteredData.reduce((n, zip) => {
      const v = zip[selectedMetric as keyof ZipData];
      return n + (typeof v === "number" && Number.isFinite(v) ? 1 : 0);
    }, 0),
    [filteredData, selectedMetric],
  );

  const regionName = useMemo(() => {
    if (regionScope === 'state') return getStateName(selectedState) || "Select a state";
    if (regionScope === 'metro') return selectedMetro || "Select a metro area";
    return "United States";
  }, [regionScope, selectedState, selectedMetro]);

  const isExportDisabled = () => {
    if (isExporting) return true;
    if (!isMapReady) return true;
    if (!hasValidSelection) return true;
    if (!scaleAvailable) return true;
    if (filteredData.length === 0) return true;
    return false;
  };

  const getButtonText = () => {
    if (isExporting) return "Exporting...";
    if (!scaleAvailable) return "Colour scale unavailable";
    if (!hasValidSelection) {
      if (regionScope === 'state') return "Select a state";
      if (regionScope === 'metro') return "Select a metro";
    }
    if (!isMapReady && filteredData.length > 0) return "Rendering...";
    return `Export ${fileFormat.toUpperCase()}`;
  };

  const openRepo = useCallback(() => {
    try { localStorage.setItem(STAR_CLICKED_KEY, "1"); } catch { /* private mode */ }
    window.open(REPO_URL, "_blank", "noopener,noreferrer");
  }, []);

  const announceDone = useCallback(() => {
    const ask = !starAskedThisSession && !starAlreadyClicked();
    if (!ask) {
      toast({ title: "Export complete", description: "Your map has been downloaded.", duration: 5000 });
      return;
    }
    starAskedThisSession = true;
    toast({
      title: "Export complete",
      description: "Domapus is free and open source. A star helps other people find it.",
      duration: 12000,
      action: (
        <ToastAction altText="Star Domapus on GitHub" onClick={openRepo}>
          Star on GitHub
        </ToastAction>
      ),
    });
  }, [openRepo]);

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
      const { canvas, links } = await printStageRef.current.exportToCanvas();
      const safeRegionName = regionName.replace(/[^a-zA-Z0-9 -]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-').trim();
      const stem = `Domapus-${selectedMetric}-${safeRegionName}`;

      if (fileFormat === "png") {
        // A blob, not a data URL. The same image as a base64 `href` is an 8.7 MB
        // string held in memory twice and refused outright by some browsers.
        const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, "image/png"));
        if (!blob) throw new Error("Could not encode the PNG");
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.download = `${stem}.png`;
        link.href = url;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
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

        // One clickable box per brand name, placed from the boxes the canvas
        // actually drew. This used to re-measure the attribution with a throwaway
        // canvas in this file and put a single rectangle where it guessed the
        // text had gone — over a line that, with the title off, was not even
        // visible, because the map had been painted on top of it.
        const scaleX = drawWidth / EXPORT_CANVAS_W;
        const scaleY = drawHeight / EXPORT_CANVAS_H;
        for (const l of links) {
          pdf.link(
            offsetX + l.x * scaleX, offsetY + l.y * scaleY,
            l.w * scaleX, l.h * scaleY,
            { url: l.url },
          );
        }

        pdf.save(`${stem}.pdf`);
      }

      announceDone();
    } catch (error: unknown) {
      console.error("Export failed:", error);
      trackError("export_failed", error instanceof Error ? error.message : "Unknown export error");
      toast({ title: "Export Failed", description: "Something went wrong.", variant: "destructive" });
    } finally {
      setIsExporting(false);
    }
  }, [fileFormat, selectedMetric, regionScope, regionName, includeLegend, includeTitle, announceDone]);

  const selectMetro = (metroName: string) => {
    setSelectedMetro(metroName);
    setMetroSearch(metroName);
    setIsMetroListOpen(false);
  };

  const clearMetroSelection = () => {
    setSelectedMetro("");
    setMetroSearch("");
    setDebouncedMetroSearch("");
    setActiveMetro(0);
    setIsMetroListOpen(true);
  };

  /** Arrow keys move the highlight, Enter takes it. Escape is left to the
   *  dialog's own handler, which closes the list before it closes the dialog. */
  const onMetroKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!isMetroListOpen) { setIsMetroListOpen(true); return; }
      const n = filteredMetros.length;
      if (n === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActiveMetro(i => (i + step + n) % n);
      return;
    }
    if (e.key === "Enter" && isMetroListOpen && filteredMetros.length > 0) {
      e.preventDefault();
      selectMetro(filteredMetros[Math.min(activeMetro, filteredMetros.length - 1)]);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-background z-50 flex flex-col md:flex-row"
      role="dialog"
      aria-modal="true"
      aria-label="Export map"
    >
      {/* Preview Area (top on mobile) */}
      <div className="order-1 md:order-2 flex-1 md:p-6 overflow-hidden flex flex-col bg-muted/30 min-h-[52vh] md:min-h-0">
        <div className="flex-1 flex items-center justify-center min-h-0 w-full">
          {hasValidSelection ? (
            <PrintStage
              ref={printStageRef}
              filteredData={filteredData}
              selectedMetric={selectedMetric}
              breaks={breaks}
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
                        role="combobox"
                        aria-expanded={isMetroListOpen}
                        aria-controls="metro-listbox"
                        aria-autocomplete="list"
                        aria-activedescendant={
                          isMetroListOpen && filteredMetros.length > 0
                            ? `metro-opt-${activeMetro}`
                            : undefined
                        }
                        onKeyDown={onMetroKeyDown}
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
                        <button
                          type="button"
                          onClick={clearMetroSelection}
                          aria-label="Clear metro selection"
                          className="absolute right-2 top-2.5 text-muted-foreground hover:text-foreground"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    {isMetroListOpen && (
                      <div
                        ref={metroListRef}
                        className="absolute z-10 w-full mt-1 bg-popover text-popover-foreground border rounded-md shadow-md max-h-[250px] overflow-y-auto"
                      >
                        {filteredMetros.length > 0 ? (
                          <div className="p-1" id="metro-listbox" role="listbox" aria-label="Metro areas">
                            {filteredMetros.map((m, i) => (
                              <button
                                key={m}
                                id={`metro-opt-${i}`}
                                data-idx={i}
                                type="button"
                                role="option"
                                tabIndex={-1}
                                aria-selected={i === activeMetro}
                                onMouseEnter={() => setActiveMetro(i)}
                                onClick={() => selectMetro(m)}
                                className={cn(
                                  "relative flex w-full cursor-pointer select-none items-center rounded-sm py-1.5 px-2 text-left text-sm outline-none",
                                  i === activeMetro && "bg-accent text-accent-foreground",
                                  selectedMetro === m && "font-medium"
                                )}
                              >
                                {m}
                              </button>
                            ))}
                          </div>
                        ) : (
                          <div className="py-6 text-center text-sm text-muted-foreground">No metro areas found.</div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {hasValidSelection && filteredData.length > 0 && (
                  <p className="text-[11px] leading-snug text-muted-foreground tabular-nums">
                    {withData.toLocaleString()} of {filteredData.length.toLocaleString()} ZIP codes report this metric
                  </p>
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
                  <div className="flex items-center space-x-2">
                    <Checkbox
                      id="c-cities"
                      checked={showCities && citiesAllowed}
                      disabled={!citiesAllowed}
                      onCheckedChange={(c) => setShowCities(c === true)}
                    />
                    <Label
                      htmlFor="c-cities"
                      className={cn(
                        "text-xs md:text-sm",
                        !citiesAllowed && "text-muted-foreground opacity-60 cursor-not-allowed",
                      )}
                    >
                      Show Cities
                    </Label>
                  </div>
                  {!citiesAllowed && (
                    <p className="text-[11px] leading-snug text-muted-foreground pl-6">
                      Unavailable at national scale
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="p-3 md:p-4 space-y-2 border-t bg-background">
          <Button id="btn-map-export" onClick={handleExport} disabled={isExportDisabled()} className="w-full" size="default">
            {(isExporting || (!isMapReady && hasValidSelection && scaleAvailable && filteredData.length > 0)) && (
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
