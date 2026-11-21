const KEY = "domapus:chunkReloadAt";
/** A second failure inside this window is a real error, not a stale tab: let it surface. */
const WINDOW_MS = 60_000;

/**
 * Deploy replaces every hashed chunk, so a tab opened before a deploy that then opens the
 * detail panel, export or methodology asks for a file that no longer exists, and the error
 * boundary showed "Something went wrong". Reload once to pick up the new build instead.
 */
export function reloadOnStaleChunk(win: Window = window): void {
  win.addEventListener("vite:preloadError", (event) => {
    try {
      if (Date.now() - Number(win.sessionStorage.getItem(KEY)) < WINDOW_MS) return;
      win.sessionStorage.setItem(KEY, String(Date.now()));
    } catch {
      return;
    }
    event.preventDefault();
    win.location.reload();
  });
}
