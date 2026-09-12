import { useState, useEffect, lazy, Suspense } from "react";
import { Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ZipTable } from "@/lib/zip-table";
import { useIsMobile } from "@/hooks/use-mobile";

const ExportSidebar = lazy(() => import("./dashboard/export/ExportSidebar").then(m => ({ default: m.ExportSidebar })));

interface MapExportProps {
  store: ZipTable | null;
  selectedMetric: string;
  /** The class boundaries the map is painting, from the manifest. Passed
   *  through so the exported map is coloured by the same authority as the live
   *  one instead of re-deriving a scale of its own. */
  breaks: readonly number[] | null;
  onExportModeChange: (isExportMode: boolean) => void;
}

export function MapExport({ store, selectedMetric, breaks, onExportModeChange }: MapExportProps) {
  const [isExportMode, setIsExportMode] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    onExportModeChange(isExportMode);
  }, [isExportMode, onExportModeChange]);

  const handleClose = () => {
    setIsExportMode(false);
  };

  const handleExportClick = () => {
    setIsExportMode(true);
  };

  if (isExportMode) {
    return (
      <Suspense fallback={
        <div className="absolute right-0 top-0 h-full w-80 bg-dashboard-panel border-l border-dashboard-border flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      }>
        <ExportSidebar
          // toRecord() is memoised and only runs here, on an explicit user
          // action — the ~173 ms object build no longer happens on page load.
          allZipData={store ? store.toRecord() : {}}
          selectedMetric={selectedMetric}
          breaks={breaks}
          onClose={handleClose}
        />
      </Suspense>
    );
  }

  return (
    <Button variant="outline" size="sm" onClick={handleExportClick}>
      <Download className="h-4 w-4" />
      {!isMobile && <span>Export</span>}
    </Button>
  );
}
