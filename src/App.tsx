import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense, type CSSProperties } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { MapPresence } from "@/lib/map-presence";
import NotFound from "./pages/NotFound";
import { trackError } from './lib/analytics';
import { routerBasename } from './lib/router-basename';

// Lazy: the methodology page is a reference document, not part of the map's
// critical path, and it should not sit in the bundle every visitor downloads.
const Methodology = lazy(() => import("./pages/Methodology"));
const Index = lazy(() => import("./pages/Index"));

const basename = routerBasename(import.meta.env.BASE_URL);

const App = () => {
  useEffect(() => {
    const handleGlobalError = (event: ErrorEvent) => {
      trackError("javascript_crash", event.message);
    };

    const handlePromiseError = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (
        reason?.name === 'AbortError' ||
        (typeof reason?.message === 'string' &&
          (reason.message.includes('signal is aborted') ||
           reason.message.includes('Request superseded') ||
           reason.message.includes('user aborted')))
      ) {
        event.preventDefault();
        return;
      }
      const message = reason?.message || "Unhandled Promise Rejection";
      trackError("promise_error", message);
    };

    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handlePromiseError);

    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handlePromiseError);
    };
  }, []);

  return (
    <TooltipProvider>
      <Toaster />
      <BrowserRouter basename={basename}>
        <Pages />
      </BrowserRouter>
    </TooltipProvider>
  );
};

const loading = <div className="h-screen w-screen flex items-center justify-center bg-background"><div className="animate-pulse text-muted-foreground">Loading...</div></div>;

// Hidden, not unmounted, at the same size so MapLibre does not resize. Visibility alone leaked:
// MapLibre's CSS sets the open attribution box back to visible, and its controls back to
// pointer-events auto. Opacity, the stacking order and `inert` cannot be undone by a child.
const HIDDEN: CSSProperties = { position: "fixed", inset: 0, zIndex: -1, opacity: 0, visibility: "hidden" };

/** Once the map has been shown it stays mounted behind the other pages, so coming back from
 *  methodology does not repeat the startup (ZIP table, worker, map and tiles). A visitor who
 *  lands on methodology never mounts it. Its own Suspense keeps a loading page from hiding it. */
function Pages() {
  const onMap = useLocation().pathname === "/";
  const [alive, setAlive] = useState(onMap);
  if (onMap && !alive) setAlive(true);
  const index = useMemo(() => <Index />, []);
  const presence = useMemo(() => ({ alive, visible: onMap }), [alive, onMap]);
  // A property, not a prop: React 18 does not know the attribute.
  const wrapper = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (wrapper.current) wrapper.current.inert = !onMap; }, [alive, onMap]);

  return (
    <MapPresence.Provider value={presence}>
      {alive && (
        <div ref={wrapper} style={onMap ? undefined : HIDDEN} aria-hidden={onMap ? undefined : true}>
          <Suspense fallback={loading}>{index}</Suspense>
        </div>
      )}
      {!onMap && (
        <Suspense fallback={loading}>
          <Routes>
            <Route path="/methodology" element={<Methodology />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      )}
    </MapPresence.Provider>
  );
}

export default App;
