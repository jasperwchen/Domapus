import type * as maplibregl from "maplibre-gl";

/** Wait for a map to settle, then capture its GL canvas as an image. */
export function captureMapCanvas(map: maplibregl.Map): Promise<HTMLCanvasElement> {
  return new Promise((resolve, reject) => {
    const CAPTURE_TIMEOUT_MS = 10_000;
    let settled = false;

    const cleanup = () => {
      clearTimeout(timeoutId);
      map.off("idle", doCapture);
      map.off("render", onRender);
      map.off("error", onError);
      map.off("remove", onRemove);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onError = () => fail(new Error("The map failed during capture. Retry the export."));
    const onRemove = () => fail(new Error("The map was removed during capture."));
    const timeoutId = setTimeout(() => fail(new Error("Map capture timed out")), CAPTURE_TIMEOUT_MS);
    const onRender = () => {
      if (settled) return;
      try {
        const canvas = map.getCanvas();
        settled = true;
        cleanup();
        resolve(canvas);
      } catch (error) { fail(error instanceof Error ? error : new Error("Map capture failed")); }
    };

    const doCapture = () => {
      if (settled) return;
      map.off("idle", doCapture);
      map.on("render", onRender);
      map.triggerRepaint();
    };

    // `loaded()` goes false again after a layout change, which is what makes a
    // capture taken right after the city-label toggle safe: this waits for the
    // symbol layers to be placed instead of grabbing the frame before them.
    map.on("error", onError);
    map.on("remove", onRemove);
    if (map.loaded() && map.isStyleLoaded()) {
      doCapture();
    } else {
      map.on("idle", doCapture);
    }
  });
}
