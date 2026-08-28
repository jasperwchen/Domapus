import { useSearchParams } from 'react-router-dom';
import { useCallback, useRef } from 'react';

export interface UrlState {
  zip?: string;
  metric?: string;
  lat?: number;
  lng?: number;
  zoom?: number;
}

export function useUrlState() {
  const [, setSearchParams] = useSearchParams();
  const debounceTimerRef = useRef<number | null>(null);

  // Update URL state (replaceState to avoid polluting browser history)
  const setUrlState = useCallback((updates: Partial<UrlState>, debounce = false) => {
    const updateParams = () => {
      setSearchParams((prev) => {
        const newParams = new URLSearchParams(prev);
        
        Object.entries(updates).forEach(([key, value]) => {
          if (value !== undefined && value !== null) {
            newParams.set(key, String(value));
          } else {
            newParams.delete(key);
          }
        });
        
        return newParams;
      }, { replace: true });
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
  }, [setSearchParams]);

  return { setUrlState };
}
