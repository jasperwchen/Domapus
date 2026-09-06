import { useEffect, lazy, Suspense } from 'react';
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import { trackError } from './lib/analytics';

// Lazy: the methodology page is a reference document, not part of the map's
// critical path, and it should not sit in the bundle every visitor downloads.
const Methodology = lazy(() => import("./pages/Methodology"));

const queryClient = new QueryClient();
const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/';

const App = () => {
  useEffect(() => {

    const redirectPath = sessionStorage.getItem('redirectPath');
    if (redirectPath) {
      sessionStorage.removeItem('redirectPath');
      const path = redirectPath.replace(basename, '');
      if (path && path !== '/' && path !== basename) {
        window.history.replaceState(null, '', basename + path);
      }
    }

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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter basename={basename}>
          <Suspense fallback={<div className="h-screen w-screen flex items-center justify-center bg-background"><div className="animate-pulse text-muted-foreground">Loading...</div></div>}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/methodology" element={<Methodology />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
};

export default App;