import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import path from "path";
import { stagePublic } from "./scripts/stage-public.mjs";

// Inline hashed paint filenames so paint and manifest requests start together.
function paintMap(): string {
  try {
    const mf = JSON.parse(readFileSync("public/data/manifest.json", "utf8"));
    const entries = Object.entries(mf.assets?.paint ?? {}).map(
      ([metric, asset]) => [metric, (asset as { file: string }).file],
    );
    if (!entries.length) throw new Error("manifest declares no paint assets");
    return JSON.stringify(Object.fromEntries(entries));
  } catch (err) {
    // Before the first data run, let the app resolve filenames from the manifest.
    console.warn("[vite] no paint map inlined:", (err as Error).message);
    return "{}";
  }
}

export default defineConfig(({ mode, command }) => {
  const base = mode === "production" ? "/Domapus/" : "/";

  // Derived from `base` rather than set in a .env file so the path is not duplicated.
  process.env.VITE_DATA_BASE = process.env.VITE_DATA_BASE || `${base}data/`;

  process.env.VITE_PAINT_MAP = paintMap();
  try {
    const mf = JSON.parse(readFileSync("public/data/manifest.json", "utf8"));
    process.env.VITE_SNAPSHOT_FILE = mf.assets?.snapshot ?? "zip-data.json";
  } catch { process.env.VITE_SNAPSHOT_FILE = "zip-data.json"; }

  return {
    base,
    publicDir: command === "build" ? false : "public",
    server: {
      host: "::",
      port: 3677,
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: (id) => {
            if (id.includes('maplibre-gl')) return 'maplibre';
          },
        },
      },
    },
    plugins: [react(), {
      name: "stage-public",
      async writeBundle(options) {
        await stagePublic(options.dir ?? "dist", /^https?:/.test(process.env.VITE_DATA_BASE ?? ""));
      },
      configureServer(server) {
        server.middlewares.use((req, _res, next) => {
          const match = req.url?.match(/^\/data\/releases\/([a-f0-9]{64})\/(.*)$/);
          if (match) {
            const mf = JSON.parse(readFileSync("public/data/manifest.json", "utf8"));
            if (match[1] === mf.release_id) req.url = `/data/${match[2]}`;
          }
          next();
        });
      },
    }],
    resolve: {
      alias: {
        "@": path.resolve(process.cwd(), "./src"),
      },
    },
  };
});
