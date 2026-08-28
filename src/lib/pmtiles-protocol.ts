// PMTiles Protocol handler for MapLibre GL
import { Protocol } from 'pmtiles';
import maplibregl from 'maplibre-gl';
import { trackError } from './analytics';

let protocolAdded = false;

export function addPMTilesProtocol() {
  if (protocolAdded) return;

  try {
    const protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
    protocolAdded = true;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : "PMTiles protocol registration failed";
    console.warn('[PMTiles] Protocol registration warning:', err);
    trackError("pmtiles_protocol_failed", errMsg);
    protocolAdded = true; // Mark as added to prevent retries
  }
}
