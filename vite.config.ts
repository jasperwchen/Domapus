import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig(({ mode }) => {
  const base = mode === "production" ? "/Domapus/" : "/";

  // Derived from `base` rather than set in a .env file so the path is not duplicated.
  process.env.VITE_DATA_BASE = process.env.VITE_DATA_BASE || `${base}data/`;

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
