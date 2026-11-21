// Metro name to landing-page slug, inlined by vite.config.ts from the same function that picks
// which metros get a page. Empty under vitest and before the first data run. Its own module so
// the 6.5 KB (gzip) list loads with the first opened panel, not on the first-paint path.
export const METRO_PAGES: Record<string, string> = JSON.parse(import.meta.env.VITE_METRO_PAGES || "{}");
