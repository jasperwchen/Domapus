import React, { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Heart, Calendar, BookOpen, Map as MapIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MetricSelector, MetricType } from "./MetricSelector";
import { SearchBox } from "./SearchBox";
import { useIsMobile } from "@/hooks/use-mobile";
import { trackError } from "@/lib/analytics";
import { fetchDataDates, formatPeriod, formatPeriodDay, formatRedfinWindow, stalePeriod, EMPTY_DATA_DATES, type DataDates } from "@/lib/data-dates";

const GithubIcon = ({ className }: { className?: string }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
    aria-hidden="true"
  >
    <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
  </svg>
);
const BASE_PATH = import.meta.env.BASE_URL;

/**
 * The header both routes share. Split out so the methodology page gets a header without the
 * map's metric selector and search.
 */
export function TopBarShell({
  subtitle, center, actions, nav = "methodology",
}: {
  /** The line under the wordmark. The map says what the site is; a document says
   *  what the document is. */
  subtitle: string;
  /** Page-specific controls. Empty on the methodology page. */
  center?: React.ReactNode;
  /** Page-specific actions, placed before the site-wide links. */
  actions?: React.ReactNode;
  /** Which route the first button goes to: the one the reader is not on. A titled
   *  icon is the exit a reader looks for, even though the logo also leads to the map. */
  nav?: "methodology" | "map";
}) {
  // Carry the query string so returning from methodology restores the map view.
  const { search } = useLocation();

  // Tailwind breakpoints, not `isMobile`: this row degrades in more than two steps.
  return (
    <header
      data-top-bar
      className="flex items-center justify-between gap-3 px-3 sm:px-5 py-2 bg-dashboard-panel border-b border-dashboard-border h-14 sm:h-16"
    >
      <div className="flex items-center gap-3 lg:gap-5 min-w-0">
        {/* No query string: the logo is the reset, a full reload into the default view. */}
        <a
          href={BASE_PATH}
          className="flex items-center gap-2 hover:opacity-80 transition-opacity min-w-0"
          title="Reset the map"
        >
          <img
            src={`${BASE_PATH}Logo.svg`}
            alt="Domapus Logo"
            width="40"
            height="40"
            className="w-8 h-8 sm:w-9 sm:h-9 flex-shrink-0"
          />
          {/* The wordmark stays at phone widths — the mobile row carries only the
              logo and the icon links, so it fits. It truncates rather than
              pushing those links off the edge if a narrower device disagrees. */}
          <div className="flex flex-col font-logo min-w-0">
            <h1 className="text-base font-bold text-dashboard-text-primary leading-tight truncate">
              Domapus
            </h1>
            <p className="text-xs text-dashboard-text-secondary leading-tight truncate hidden sm:block">
              {subtitle}
            </p>
          </div>
        </a>
        {center}
      </div>

      <div className="flex items-center justify-end flex-1 min-w-0 gap-2 sm:gap-3">
        {actions}

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {nav === "map" ? (
            <IconLink href={`${BASE_PATH}${search}`} label="Map">
              <MapIcon className="h-4 w-4" />
            </IconLink>
          ) : (
            <IconLink to={`/methodology${search}`} label="Methodology">
              <BookOpen className="h-4 w-4" />
            </IconLink>
          )}
          <IconLink href="https://github.com/jasperwchen/Domapus" label="GitHub" external>
            <GithubIcon className="h-4 w-4" />
          </IconLink>
          <IconLink
            href="https://buymeacoffee.com/JasperC"
            label="Sponsor"
            external
            className="bg-pink-600 hover:bg-pink-700 text-white"
          >
            <Heart className="h-4 w-4" />
          </IconLink>
        </div>
      </div>
    </header>
  );
}

/** Icon plus a label shown when there is room; `title` names it at every width.
 *
 *  `to`: client-side route, same tab.
 *  `href`: full page load to the map, so index.html's boot fetches run in parallel with the
 *  bundle (and `useHref` would drop the canonical trailing slash).
 *  `href` + `external`: leaves the site in a new tab, announced for screen readers. */
type IconLinkProps = {
  label: string;
  className?: string;
  external?: boolean;
  children: React.ReactNode;
} & ({ to: string; href?: never } | { href: string; to?: never });

function IconLink({ label, className, external = false, children, ...dest }: IconLinkProps) {
  const inner = (
    <>
      {children}
      <span className="hidden xl:inline">{label}</span>
    </>
  );
  return (
    <Button variant="outline" size="sm" asChild className={className}>
      {dest.to !== undefined ? (
        <Link to={dest.to} title={label}>{inner}</Link>
      ) : external ? (
        <a
          href={dest.href}
          title={label}
          aria-label={`${label} (opens in a new tab)`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {inner}
        </a>
      ) : (
        <a href={dest.href} title={label}>{inner}</a>
      )}
    </Button>
  );
}

interface TopBarProps {
  selectedMetric: MetricType;
  onMetricChange: (metric: MetricType) => void;
  onSearch: (zipCode: string, trigger: number) => void;
  hideMobileControls?: boolean;
  children?: React.ReactNode; // Optional buttons like <MapExport />
}

export function TopBar({
  selectedMetric,
  onMetricChange,
  onSearch,
  hideMobileControls = false,
  children,
}: TopBarProps) {
  const isMobile = useIsMobile();
  const [dataDates, setDataDates] = useState<DataDates>(EMPTY_DATA_DATES);

  useEffect(() => {
    let isMounted = true;
    fetchDataDates()
      .then((dates) => { if (isMounted) setDataDates(dates); })
      .catch((err: unknown) => {
        console.error("Error fetching last_updated.json:", err);
        trackError("last_updated_fetch_failed", err instanceof Error ? err.message : "Failed to fetch last updated");
      });
    return () => { isMounted = false; };
  }, []);

  const isZillowMetric = selectedMetric.startsWith("zhvi");
  const activePeriod = isZillowMetric
    ? dataDates.zhvi_period_end ?? dataDates.period_end
    : dataDates.period_end;
  const sourceLabel = isZillowMetric ? "Zillow" : "Redfin";
  // Zillow ZHVI is a monthly index, so "Jul 2026" is the honest label. Redfin
  // rows are a rolling three-month window, so the header names the window.
  // NOT "90 days": the window is calendar-aligned and runs 89-92 days.
  const periodLabel = isZillowMetric ? "Data through:" : "3 months ending:";
  const periodValue = isZillowMetric ? formatPeriod(activePeriod) : formatPeriodDay(activePeriod);
  const periodPhrase = isZillowMetric
    ? `through ${formatPeriod(activePeriod)}`
    : formatRedfinWindow(activePeriod);
  const stale = stalePeriod(dataDates);
  const runDate = dataDates.last_updated_utc
    ? new Date(dataDates.last_updated_utc).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })
    : "unknown";

  return (
    <>
      <TopBarShell
        subtitle="Housing Market Analysis"
        center={!isMobile ? (
          <MetricSelector selectedMetric={selectedMetric} onMetricChange={onMetricChange} />
        ) : undefined}
        actions={
          <>
            {!isMobile && (
              <div className="w-full max-w-[260px] min-w-[104px] flex-shrink">
                <SearchBox onSearch={onSearch} />
              </div>
            )}
            {/* The only date on screen until a ZIP is opened, so it stays down to xl, where it still leaves the search box its width. */}
            {!isMobile && (
              <div
                className="items-center text-dashboard-text-secondary gap-2 flex-shrink-0 hidden xl:flex"
                title={`${sourceLabel} data, ${periodPhrase}. Site last refreshed ${runDate}.`}
              >
                <Calendar className="h-4 w-4 opacity-80" />
                <div className="flex flex-col">
                  <span className="text-xs font-medium whitespace-nowrap">{periodLabel}</span>
                  <span className="text-xs font-medium whitespace-nowrap">{periodValue}</span>
                </div>
              </div>
            )}
            {children}
          </>
        }
      />

      {stale && (
        <div role="status" className="px-3 sm:px-5 py-1.5 text-xs text-center bg-amber-50 text-amber-900 border-b border-amber-200">
          This data is older than usual: the latest figures cover the period ending {formatPeriodDay(stale)}.
          A newer monthly update has not been published yet.
        </div>
      )}

      {/* === Mobile Bottom Bar === */}
      {isMobile && !hideMobileControls && (
        <div
          className="fixed left-4 right-4 z-[1001] bg-dashboard-panel border border-dashboard-border rounded-lg p-3 shadow-lg"
          style={{ bottom: 'calc(1rem + env(safe-area-inset-bottom))' }}
        >
          <div className="space-y-2.5">
            <MetricSelector selectedMetric={selectedMetric} onMetricChange={onMetricChange} />
            <SearchBox onSearch={onSearch} />
          </div>
        </div>
      )}
    </>
  );
}
