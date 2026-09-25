// Unmounted for now, kept on purpose by the owner to switch back on later. Not dead code:
// do not delete this file or the commented-out mount in HousingDashboard.tsx.
import { useEffect } from "react";
import { X, Heart } from "lucide-react";
import { Button } from "@/components/ui/button";

interface SponsorBannerProps {
  onClose: () => void;
}

export function SponsorBanner({ onClose }: SponsorBannerProps) {
  useEffect(() => {
    const timeout = setTimeout(onClose, 20000);
    return () => clearTimeout(timeout);
  }, [onClose]);

  return (
    <div className="fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-full mx-4">
      <div className="bg-dashboard-panel border border-dashboard-border rounded-lg shadow-lg p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-3">
            <Heart className="h-5 w-5 text-pink-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-dashboard-text-primary">
              <p className="font-semibold mb-1">This site is proudly ad-free and built to serve the public.</p>
              <p className="text-dashboard-text-secondary">
                If you find it useful, please consider sponsoring or supporting us to keep the data flowing and the site improving.
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-6 w-6 p-0 flex-shrink-0"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        
        <div className="mt-3 flex space-x-2">
          <Button 
            size="sm" 
            asChild
            className="bg-pink-600 hover:bg-pink-700 text-white"
          >
            <a 
              href="https://buymeacoffee.com/jasperc" 
              target="_blank" 
              rel="noopener noreferrer"
            >
              <Heart className="h-4 w-4 mr-2" />
              Sponsor
            </a>
          </Button>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={onClose}
          >
            Maybe later
          </Button>
        </div>
      </div>
    </div>
  );
}
