// PMTiles Protocol handler for MapLibre GL
import { Protocol } from 'pmtiles';
import { addProtocol } from 'maplibre-gl';
import type { AddProtocolAction, GetResourceResponse, AddProtocolResponseData } from 'maplibre-gl';
import { trackError } from './analytics';

let protocolAdded = false;

/** How long a finished tile stays shareable, for a second source that asks a little later. */
const KEEP_MS = 5_000;

/**
 * One fetch per tile URL however many sources ask for it. The map reads the ZIP tileset
 * through two sources (classes on one, highlight flags on the other), and each fetched every
 * tile: +1.34 MB and +7 requests on a cold load. Each caller gets its own copy of the bytes,
 * because MapLibre transfers the ArrayBuffer to a worker and detaches it. The shared fetch is
 * aborted only once every caller has aborted.
 */
export function shareTileFetches(load: AddProtocolAction): AddProtocolAction {
  const shared = new Map<string, {
    result: Promise<GetResourceResponse<AddProtocolResponseData>>;
    controller: AbortController;
    waiting: number;
  }>();
  return (params, abort) => {
    if (params.type === "json") return load(params, abort);
    const key = params.url;
    let entry = shared.get(key);
    if (!entry) {
      const controller = new AbortController();
      const result = load(params, controller);
      const created = { result, controller, waiting: 0 };
      shared.set(key, created);
      result.then(
        () => setTimeout(() => { if (shared.get(key) === created) shared.delete(key); }, KEEP_MS),
        () => { if (shared.get(key) === created) shared.delete(key); },
      );
      entry = created;
    }
    const mine = entry;
    mine.waiting++;
    abort.signal.addEventListener("abort", () => {
      if (--mine.waiting > 0) return;
      if (shared.get(key) === mine) shared.delete(key);
      mine.controller.abort();
    }, { once: true });
    // pmtiles answers with a Uint8Array; handing both callers the same one left the second
    // with a detached buffer and every one of its tiles errored.
    return mine.result.then((r) => ({
      ...r,
      data: r.data instanceof Uint8Array ? r.data.slice()
        : r.data instanceof ArrayBuffer ? r.data.slice(0) : r.data,
    }));
  };
}

export function addPMTilesProtocol() {
  if (protocolAdded) return;

  try {
    const protocol = new Protocol();
    addProtocol('pmtiles', shareTileFetches(protocol.tile));
    protocolAdded = true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "PMTiles protocol registration failed";
    console.warn('[PMTiles] Protocol registration warning:', err);
    trackError("pmtiles_protocol_failed", errMsg);
    protocolAdded = true; // Mark as added to prevent retries
  }
}
