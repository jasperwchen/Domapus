import { describe, it, expect } from 'vitest';
import {
  formatMetricValue,
  formatChange,
  getStateName,
  createMetricPopupContent,
} from '../utils';
import { ZipData } from '../types';

describe('formatMetricValue', () => {
  it('should format currency values correctly', () => {
    expect(formatMetricValue(1234567, 'price')).toBe('$1,234,567');
  });

  it('should format percent values correctly', () => {
    expect(formatMetricValue(25.5, 'percent')).toBe('25.5%');
    expect(formatMetricValue(10, 'percent')).toBe('10.0%');
  });

  it('should format number, days and months correctly', () => {
    expect(formatMetricValue(1234, 'number')).toBe('1,234');
    expect(formatMetricValue(50, 'days')).toBe('50 days');
    expect(formatMetricValue(4.9, 'months')).toBe('4.9 months');
  });

  it('should return N/A for null, undefined, or NaN', () => {
    expect(formatMetricValue(null, 'price')).toBe('N/A');
    expect(formatMetricValue(undefined, 'percent')).toBe('N/A');
    expect(formatMetricValue(NaN, 'number')).toBe('N/A');
  });
});

describe('formatChange', () => {
  it('should format positive changes correctly', () => {
    const result = formatChange(5.5);
    expect(result.formatted).toBe('+5.5%');
    expect(result.isPositive).toBe(true);
    expect(result.isZero).toBe(false);
  });

  it('should format negative changes correctly', () => {
    const result = formatChange(-3.2);
    expect(result.formatted).toBe('-3.2%');
    expect(result.isPositive).toBe(false);
    expect(result.isZero).toBe(false);
  });

  it('should format zero change correctly', () => {
    const result = formatChange(0);
    expect(result.formatted).toBe('0.0%');
    expect(result.isPositive).toBe(false);
    expect(result.isZero).toBe(true);
  });

  it('should return N/A for null or undefined', () => {
    const result1 = formatChange(null);
    expect(result1.formatted).toBe('N/A');
    expect(result1.isZero).toBe(true);

    const result2 = formatChange(undefined);
    expect(result2.formatted).toBe('N/A');
    expect(result2.isZero).toBe(true);
  });
});

describe('formatChange units', () => {
  // Not every change is a percent, and rendering one as a percent is a
  // correctness bug. Redfin ships MEDIAN DAYS ON MARKET YOY and MONTHS OF SUPPLY
  // YOY as (now - year_ago) x 100 under a "(%)" suffix that is a lie; the
  // pipeline divides by 100 and these formats keep the honest unit.
  it('renders a day difference in days, never percent', () => {
    expect(formatChange(16.55, 'days').formatted).toBe('+17 days');
    expect(formatChange(-24.96, 'days').formatted).toBe('-25 days');
    expect(formatChange(1, 'days').formatted).toBe('+1 day');
    expect(formatChange(16.55, 'days').formatted).not.toContain('%');
  });

  it('renders a months difference in months, never percent', () => {
    expect(formatChange(-1.38, 'months').formatted).toBe('-1.4 months');
    expect(formatChange(-1.38, 'months').formatted).not.toContain('%');
  });

  it('renders a percentage-point change as points, not percent', () => {
    // A share going 48.5% -> 50.8% moved 2.3 POINTS, not 2.3 percent.
    expect(formatChange(2.27, 'ppt').formatted).toBe('+2.3 pts');
  });

  it('defaults to percent', () => {
    expect(formatChange(4.23).formatted).toBe('+4.2%');
  });
});

describe('getStateName', () => {
  it('should return full state name for valid codes', () => {
    expect(getStateName('CA')).toBe('California');
    expect(getStateName('NY')).toBe('New York');
    expect(getStateName('TX')).toBe('Texas');
  });

  it('should handle lowercase codes', () => {
    expect(getStateName('ca')).toBe('California');
    expect(getStateName('ny')).toBe('New York');
  });

  it('should return original code for invalid codes', () => {
    expect(getStateName('XX')).toBe('XX');
  });

  it('should return N/A for null or undefined', () => {
    expect(getStateName(null)).toBe('N/A');
    expect(getStateName(undefined)).toBe('N/A');
  });
});

describe('createMetricPopupContent', () => {
  const base = {
    zipCode: '90210',
    city: 'Beverly Hills',
    state: 'CA',
    zhvi: 3500000,
  } as unknown as ZipData;

  it('renders the ZIP, place and metric value', () => {
    const el = createMetricPopupContent(base, 'zhvi');
    const text = el.textContent ?? '';
    expect(text).toContain('90210');
    expect(text).toContain('Beverly Hills');
    expect(text).toContain('California');
    expect(text).toContain('$3,500,000');
  });

  it('falls back when the metric has no value', () => {
    const el = createMetricPopupContent({ ...base, zhvi: null } as ZipData, 'zhvi');
    expect(el.textContent).toContain('N/A');
  });

  it('handles a missing record', () => {
    const el = createMetricPopupContent({} as ZipData, 'zhvi');
    expect(el.textContent).toBe('No data available');
  });

  it('treats markup in the data as text, never as HTML', () => {
    // Guards the popup against a place name that contains markup. The old
    // string + setHTML version would have parsed and run this.
    const hostile = {
      ...base,
      city: '<img src=x onerror="window.__pwned=1">',
    } as unknown as ZipData;

    const el = createMetricPopupContent(hostile, 'zhvi');

    expect(el.querySelector('img')).toBeNull();
    expect(el.textContent).toContain('<img src=x onerror=');
  });
});
