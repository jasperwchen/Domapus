import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";

// The metric -> hashed-paint-filename map, resolved at BUILD time so index.html
// can start the paint fetch without first reading the manifest at runtime. The
// filenames carry a content hash, so they cannot be preloaded from static HTML
// any other way.
//
// Three things already force the inline and the deployed release to agree: the
// build reads the same committed manifest the deploy verifies with `sha256sum
// -c`, `PaintTable.from()` rejects a wrong byteLength, and the manifest changes
// exactly once a month in the run that rebuilds the site.
function paintMap(): string {
  try {
    const mf = JSON.parse(readFileSync("public/data/manifest.json", "utf8"));
    const entries = Object.entries(mf.assets?.paint ?? {}).map(
      ([metric, asset]) => [metric, (asset as { file: string }).file],
    );
    if (!entries.length) throw new Error("manifest declares no paint assets");
    return JSON.stringify(Object.fromEntries(entries));
  } catch (err) {
    // A build before the first pipeline run has no manifest yet. Fail soft with
    // an empty map: the app falls back to fetching the manifest at runtime, one
    // round trip slower, rather than failing the build.
    console.warn("[vite] no paint map inlined:", (err as Error).message);
    return "{}";
  }
}

export default defineConfig(({ mode }) => {
  const base = mode === "production" ? "/Domapus/" : "/";

  // Derived from `base` rather than set in a .env file so the path is not duplicated.
  process.env.VITE_DATA_BASE = process.env.VITE_DATA_BASE || `${base}data/`;

  process.env.VITE_PAINT_MAP = paintMap();

  return {
    base,
    server: {
      host: "::",
      port: 3677,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('maplibre-gl')) return 'maplibre';
            if (id.includes('jspdf')) return 'pdf-export';
          },
        },
      },
    },
    plugins: [react()],
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "./src"),
      },
    },
  };
});
