import { useLocation, useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMapPresence } from '@/lib/map-presence';

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
  const location = useLocation();
  const [navigation, setNavigation] = useState(location);
  const ownSearchRef = useRef<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const paramsRef = useRef(searchParams);
  const writerRef = useRef(setSearchParams);
  paramsRef.current = searchParams;
  writerRef.current = setSearchParams;
  const debounceTimerRef = useRef<number | null>(null);
  const { visible } = useMapPresence();
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // The search the map last showed. Coming back to it from a page the map sat hidden behind is
  // not a navigation: re-applying it would move the camera and reset the panels.
  const shownSearchRef = useRef(location.search);
  const hiddenRef = useRef(!visible);
  useLayoutEffect(() => {
    if (!visible) {
      hiddenRef.current = true;
      return;
    }
    const returning = hiddenRef.current;
    hiddenRef.current = false;
    if (returning && location.search === shownSearchRef.current) return;
    shownSearchRef.current = location.search;
    if (ownSearchRef.current === location.search) {
      ownSearchRef.current = null;
      return;
    }
    ownSearchRef.current = null;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    setNavigation(location);
  }, [location, visible]);
  useEffect(() => () => {
    if (debounceTimerRef.current !== null) window.clearTimeout(debounceTimerRef.current);
  }, []);

  // Update URL state (replaceState to avoid polluting browser history)
  const setUrlState = useCallback((updates: Partial<UrlState>, debounce = false) => {
    const updateParams = () => {
      // Hidden behind another page, a write would put the map's address over that page's.
      if (!visibleRef.current) return;
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
      ownSearchRef.current = newParams.size ? `?${newParams}` : '';
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

  return { setUrlState, navigation };
}
