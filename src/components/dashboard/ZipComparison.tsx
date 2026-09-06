import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Search } from 'lucide-react';
import { ZipData } from './map/types';
import type { ZipTable } from '@/lib/zip-table';
import { formatMetricValue, getComparison, METRIC_DEFINITIONS, FormatType } from './map/utils';

interface ZipComparisonProps {
  currentZip: ZipData;
  store: ZipTable | null;
}

export function ZipComparison({ currentZip, store }: ZipComparisonProps) {
  const [searchZip, setSearchZip] = useState('');
  const [compareZip, setCompareZip] = useState<ZipData | null>(null);
  const [error, setError] = useState('');

  const handleSearch = () => {
    if (!searchZip.trim()) return;

    setError('');
    const foundZip = store?.get(searchZip.trim()) ?? null;

    if (foundZip) {
      setCompareZip(foundZip);
    } else {
      setError('ZIP code not found in our database.');
      setCompareZip(null);
    }
  };

  // The list of metrics to compare (using shared definitions)
  const metrics = Object.values(METRIC_DEFINITIONS).map(m => ({
    key: m.key,
    label: m.label,
    format: m.format
  }));

  return (
    <div className="space-y-4 pt-2">
      <div className="flex space-x-2">
        <Input
          type="text"
          pattern="[0-9]*"
          inputMode="numeric"
          maxLength={5}
          placeholder="Enter ZIP code..."
          value={searchZip}
          onChange={(e) => setSearchZip(e.target.value.replace(/\D/g, ''))}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); }}
          aria-label="ZIP code to compare"
        />
        <Button onClick={handleSearch} size="sm" aria-label="Search">
          <Search className="h-4 w-4" />
        </Button>
      </div>

      {error && <div className="text-sm text-red-500 p-2 rounded bg-red-50">{error}</div>}

      {compareZip && (
        <div className="space-y-3 pt-2">
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div><Badge variant="secondary">{currentZip.zipCode}</Badge><div className="text-xs text-muted-foreground mt-1">{currentZip.city}</div></div>
            <div className="text-xs text-muted-foreground self-center">vs</div>
            <div><Badge variant="secondary">{compareZip.zipCode}</Badge><div className="text-xs text-muted-foreground mt-1">{compareZip.city}</div></div>
          </div>

          <div className="space-y-2">
            {metrics.map((metric) => {
              const currentValue = currentZip[metric.key] as number | null;
              const compareValue = compareZip[metric.key] as number | null;
              const comparison = getComparison(currentValue, compareValue);
              const isGoodHigher = metric.key !== 'median_dom'; // Higher is better for most metrics, except Days on Market

              return (
                <Card key={metric.key}>
                  <CardContent className="p-3">
                    <div className="text-center mb-2 text-xs font-medium text-muted-foreground">{metric.label}</div>
                    <div className="grid grid-cols-2 gap-4">
                      <div className={`text-center font-bold text-sm ${comparison === 'higher' ? (isGoodHigher ? 'text-green-600' : 'text-red-600') : comparison === 'lower' ? (isGoodHigher ? 'text-red-600' : 'text-green-600') : ''}`}>{formatMetricValue(currentValue, metric.format as FormatType)}</div>
                      <div className={`text-center font-bold text-sm ${comparison === 'lower' ? (isGoodHigher ? 'text-green-600' : 'text-red-600') : comparison === 'higher' ? (isGoodHigher ? 'text-red-600' : 'text-green-600') : ''}`}>{formatMetricValue(compareValue, metric.format as FormatType)}</div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
