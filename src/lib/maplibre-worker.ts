import { setWorkerUrl } from "maplibre-gl";
// `?worker&url` and not plain `?url`: the dist worker imports a sibling
// `maplibre-gl-shared.mjs`, and `?url` emits the worker file verbatim in a
// production build without that sibling. The worker then dies on its first
// import and no vector tiles ever load — a blank map with a console error.
// `?worker&url` routes it through Vite's worker pipeline as a self-contained
// chunk. Dev mode is forgiving of either, so this only breaks in `npm run build`.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

// maplibre-gl v6 is ESM-only and resolves its worker from `import.meta.url`,
// which a bundler's module graph does not point at the real file. Under Vite
// every consumer has to hand it the URL once, before the first `new Map()`.
// Module scope, so importing this file anywhere is enough.
setWorkerUrl(workerUrl);
