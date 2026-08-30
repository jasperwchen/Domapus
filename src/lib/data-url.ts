// PR previews set VITE_DATA_BASE to the production data directory so they don't
// ship their own 92 MB copy of the tileset. vite.config.ts always defines it.
export function dataUrl(file: string): string {
  return new URL(`${import.meta.env.VITE_DATA_BASE}${file}`, window.location.origin).href;
}
