import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useRef } from 'react';

export interface UrlState {
  zip?: string;
  metric?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
}

export function parseView(params: URLSearchParams): Pick<UrlState, "lat" | "lng" | "zoom"> {
  const read = (key: string, min: number, max: number) => {
    const raw = params.get(key);
    const n = raw?.trim() ? Number(raw) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : undefined;
  };
  const lat = read("lat", -85.051129, 85.051129);
  const lng = read("lng", -180, 180);
  return { lat: lat !== undefined && lng !== undefined ? lat : undefined,
    lng: lat !== undefined && lng !== undefined ? lng : undefined,
    zoom: read("zoom", 2, 18) };
}

export function useUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsRef = useRef(searchParams);
  const writerRef = useRef(setSearchParams);
  paramsRef.current = searchParams;
  writerRef.current = setSearchParams;
  const debounceTimerRef = useRef<number | null>(null);
  useEffect(() => () => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
  }, []);

  // Update URL state (replaceState to avoid polluting browser history)
  const setUrlState = useCallback((updates: Partial<UrlState>, debounce = false) => {
    const updateParams = () => {
      // Delayed viewport writes must merge with the latest selection, including a close.
      const newParams = new URLSearchParams(paramsRef.current);
      Object.entries(updates).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          newParams.set(key, String(value));
        } else {
          newParams.delete(key);
        }
      });
      paramsRef.current = newParams;
      writerRef.current(newParams, { replace: true });
    };

    if (debounce) {
      // Debounce map position updates
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = window.setTimeout(() => {
        updateParams();
        debounceTimerRef.current = null;
      }, 500);
    } else {
      updateParams();
    }
  }, []);

  return { setUrlState };
}
