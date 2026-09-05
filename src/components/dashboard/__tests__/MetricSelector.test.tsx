import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricSelector, METRICS } from '../MetricSelector';
import { PAINTED_METRICS } from '@/lib/metrics';

describe('MetricSelector', () => {
  it('should display the currently selected metric', () => {
    const mockOnChange = vi.fn();
    render(
      <MetricSelector selectedMetric="median_ppsf" onMetricChange={mockOnChange} />
    );

    // The selected value should be displayed
    expect(screen.getByText('Median Price per Sq Ft')).toBeInTheDocument();
  });

  it('offers exactly the 8 painted metrics, not all 15', () => {
    // The dropdown is the PAINTED subset. The other 7 metrics ship on the wire
    // and appear in the ZIP detail panel, but never colour the map: pairwise
    // Spearman collapses the 14 Redfin metrics to ~5 independent axes, so
    // offering all of them would be offering the same map several times.
    const metricEntries = Object.entries(METRICS);
    expect(metricEntries.length).toBe(8);

    const expectedMetrics = [
      'Zillow Home Value Index',
      'Median Sale Price',
      'Median Price per Sq Ft',
      'Homes Sold',
      'Active Listings',
      'Median Days on Market',
      '% Sold Above List',
      'Months of Supply',
    ];

    const actualMetrics = metricEntries.map(([, label]) => label);
    for (const metric of expectedMetrics) {
      expect(actualMetrics).toContain(metric);
    }
  });

  it('should have correct metric keys', () => {
    const metricKeys = Object.keys(METRICS);
    const expectedKeys = [
      'zhvi',
      'median_sale_price',
      'median_ppsf',
      'homes_sold',
      'active_listings',
      'median_dom',
      'sold_above_list',
      'months_of_supply',
    ];

    expect(metricKeys.length).toBe(8);
    for (const key of expectedKeys) {
      expect(metricKeys).toContain(key);
    }
  });

  it('carries no Redfin month-over-month key', () => {
    // Redfin publishes no MoM at ZIP level: 0 non-null cells in 4,930,000 x 14.
    // Only ZHVI, which is smoothed and seasonally adjusted, keeps one.
    const withMom = Object.values(PAINTED_METRICS).filter((m) => m.momKey);
    expect(withMom.map((m) => m.key)).toEqual(['zhvi']);
  });
});
