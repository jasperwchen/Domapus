import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X, MousePointerClick } from 'lucide-react';
import { ZipData } from './map/types';
import type { ZipTable } from '@/lib/zip-table';
import { formatMetricValue, METRIC_DEFINITIONS, FormatType } from './map/utils';
import { METRIC_GROUPS } from '@/lib/metrics';

interface ZipComparisonProps {
  currentZip: ZipData;
  /** Owned by `HousingDashboard`, so a map click can fill it. Keeping it local
   *  here is what made clicking the map replace the left-hand ZIP instead. */
  compareZip: ZipData | null;
  onCompareZipChange: (zip: ZipData | null) => void;
  store: ZipTable | null;
}

export function ZipComparison({
  currentZip, compareZip, onCompareZipChange, store,
}: ZipComparisonProps) {
  const [searchZip, setSearchZip] = useState('');
  const [error, setError] = useState('');

  const handleSearch = () => {
    const q = searchZip.trim();
    if (!q) return;
    if (q === currentZip.zipCode) {
      setError('That is the ZIP you are comparing from.');
      return;
    }
    const found = store?.get(q) ?? null;
    if (found) {
      setError('');
      onCompareZipChange(found);
      setSearchZip('');
    } else {
      setError('No ZIP code by that number in this release.');
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input
          type="text"
          pattern="[0-9]*"
          inputMode="numeric"
          maxLength={5}
          placeholder="ZIP code"
          value={searchZip}
          onChange={(e) => setSearchZip(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          aria-label="ZIP code to compare"
          className="h-9"
        />
        <Button onClick={handleSearch} size="sm" className="h-9 px-3" aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {/* The map is an input here and nothing used to say so. */}
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MousePointerClick className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Or click any ZIP on the map.
      </p>

      {error && <p className="text-xs text-rose-600">{error}</p>}

      {!compareZip ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm font-medium text-foreground">
            Comparing from {currentZip.zipCode}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Pick a second ZIP to see the two side by side.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold tabular-nums text-foreground">{currentZip.zipCode}</p>
              <p className="truncate text-[11px] text-muted-foreground">{currentZip.city || 'n/a'}</p>
            </div>
            <span className="text-[11px] font-medium text-muted-foreground">vs</span>
            <div className="flex-1 min-w-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-foreground">{compareZip.zipCode}</p>
              <p className="truncate text-[11px] text-muted-foreground">{compareZip.city || 'n/a'}</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground"
              onClick={() => onCompareZipChange(null)}
              aria-label="Clear comparison"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>

          {METRIC_GROUPS.map((group) => (
            <Group key={group.id} label={group.label} keys={group.keys} a={currentZip} b={compareZip} />
          ))}
        </>
      )}
    </div>
  );
}

/**
 * One group as a four-column table: metric, A, B, difference.
 *
 * NO GOOD/BAD COLOURING. The old version painted the larger value green unless
 * the metric was days-on-market, which is wrong for months-of-supply — more
 * inventory is good for a buyer and bad for a seller — and meaningless for homes
 * sold. Which direction is "better" depends on which side of the transaction the
 * reader is on, and the panel does not know that. The difference is shown; the
 * judgement is the reader's.
 */
function Group({
  label, keys, a, b,
}: {
  label: string;
  keys: string[];
  a: ZipData;
  b: ZipData;
}) {
  const rows = keys
    .map((k) => METRIC_DEFINITIONS[k])
    .filter(Boolean)
    .map((m) => ({
      m,
      av: a[m.key as keyof ZipData] as number | null,
      bv: b[m.key as keyof ZipData] as number | null,
    }))
    .filter(({ av, bv }) => Number.isFinite(av as number) || Number.isFinite(bv as number));

  if (!rows.length) return null;

  return (
    <section>
      <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h4>
      <div className="rounded-lg border border-border bg-card divide-y divide-border/60">
        {rows.map(({ m, av, bv }) => (
          <div key={m.key as string} className="flex items-baseline gap-2 px-3 py-2">
            {/* Four columns in a 384 px panel means the label column truncates.
                The title keeps the full name reachable rather than lost. */}
            <span
              className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
              title={m.label}
            >
              {m.label}
            </span>
            <span className="w-[72px] shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
              {formatMetricValue(av, m.format as FormatType)}
            </span>
            <span className="w-[72px] shrink-0 text-right text-xs font-semibold tabular-nums text-foreground">
              {formatMetricValue(bv, m.format as FormatType)}
            </span>
            <span className="w-[56px] shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
              {relative(av, bv)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** B against A as a percentage, or an em dash where the ratio is undefined.
 *  Percent of A, not a difference in the metric's own unit: the column is one
 *  width for fifteen metrics on five different scales. */
function relative(a: number | null, b: number | null): string {
  if (!Number.isFinite(a as number) || !Number.isFinite(b as number) || a === 0) return 'n/a';
  const pct = ((b as number) - (a as number)) / Math.abs(a as number) * 100;
  if (Math.abs(pct) < 0.5) return '±0%';
  return `${pct > 0 ? '+' : ''}${pct.toFixed(0)}%`;
}
