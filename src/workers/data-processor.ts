import { ZipData } from "../components/dashboard/map/types";
import { getMetricValue } from "../lib/metric-value";
import { computeQuantileBounds5_95 } from "../lib/quantiles";
import { WorkerMessage, LoadDataRequest } from "./worker-types";

let currentAbortController: AbortController | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = e.data;

  if (currentAbortController) {
    currentAbortController.abort('superseded');
  }
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // Each invocation owns its own id. When a later message aborts this one, the
  // ABORTED reply must carry THIS id — the caller keys pending promises by id,
  // and replying with the newer id would settle the wrong request.
  const abortCurrent = () => {
    self.postMessage({ type: "ABORTED", id });
  };

  try {
    switch (type) {
      case "LOAD_AND_PROCESS_DATA": {
        const { url, selectedMetric, prefetchedBuffer } = data as LoadDataRequest;

        let buffer: ArrayBuffer;

        if (prefetchedBuffer && prefetchedBuffer.byteLength > 100) {
          buffer = prefetchedBuffer;
          self.postMessage({ type: "PROGRESS", data: { phase: "Processing cached data..." } });
        } else {
          self.postMessage({ type: "PROGRESS", data: { phase: "Fetching market data..." } });
          const response = await fetch(url, { signal });
          if (!response.ok) {
            if (response.status === 404) {
              throw new Error("Data file not found. Please try refreshing the page.");
            } else if (response.status >= 500) {
              throw new Error("Server error. Please try again later.");
            }
            throw new Error(`Failed to load data (${response.status}). Please try refreshing.`);
          }

          const contentLength = response.headers.get('content-length');
          if (contentLength && parseInt(contentLength) < 100) {
            throw new Error("Data file appears to be empty or incomplete. Please try refreshing.");
          }

          buffer = await response.arrayBuffer();
          if (buffer.byteLength < 100) {
            throw new Error("Received incomplete data. Please check your connection and try again.");
          }
        }

        let fullPayload: unknown;
        try {
          const jsonText = new TextDecoder().decode(buffer);

          if (jsonText.startsWith('version https://git-lfs.github.com')) {
            console.error('[Worker] Received Git LFS pointer instead of actual data file');
            throw new Error("Data file not available. The server returned a placeholder instead of actual data. Please try refreshing or contact support.");
          }

          fullPayload = JSON.parse(jsonText);
          if (!fullPayload || typeof fullPayload !== 'object') {
            throw new Error("Invalid data format: expected object");
          }
        } catch (err) {
          console.error('[Worker] JSON parse failed:', err);
          const errMessage = err instanceof Error ? err.message : "Unknown error";
          const detailedError = errMessage.includes('Unexpected token') || errMessage.includes('JSON')
            ? `JSON parse error: Data file appears corrupted or incomplete (${errMessage})`
            : `JSON parse error: ${errMessage}`;
          throw new Error(detailedError);
        }

        // The pipeline emits only the columnar format. The legacy keyed
        // format ({"zip_codes": {...}}) is no longer produced and is no
        // longer supported here.
        if (
          typeof fullPayload !== 'object' || fullPayload === null ||
          !('f' in fullPayload) || !('z' in fullPayload) || !('d' in fullPayload)
        ) {
          throw new Error("Invalid data format: expected columnar format with keys f, z, d");
        }

        const { f: fields, z: zipCodes, d: rows } = fullPayload as {
          last_updated_utc?: string;
          f: string[];
          z: string[];
          d: (string | number | null)[][];
        };

        if (zipCodes.length !== rows.length) {
          throw new Error(`Columnar data is malformed: ${zipCodes.length} zip codes but ${rows.length} rows`);
        }

        const last_updated_utc = (fullPayload as { last_updated_utc?: string }).last_updated_utc;
        const zipData: Record<string, ZipData> = {};
        const metricValues: number[] = [];
        const BATCH_SIZE = 5000;

        self.postMessage({ type: "PROGRESS", data: { phase: "Reconstructing ZIP data..." } });

        for (let i = 0; i < zipCodes.length; i++) {
          if (signal.aborted) {
            abortCurrent();
            return;
          }

          const zipCode = zipCodes[i];
          const row = rows[i];
          const entry: Record<string, unknown> = { zipCode };

          for (let j = 0; j < fields.length; j++) {
            entry[fields[j]] = row[j];
          }

          // Handle lat/lng aliases (pipeline emits lat/lng; ZipData uses latitude/longitude)
          const dataRecord = entry as unknown as ZipData;
          const entryWithCoords = entry as { lat?: number | null; lng?: number | null };
          if (dataRecord.latitude === undefined) dataRecord.latitude = entryWithCoords.lat ?? null;
          if (dataRecord.longitude === undefined) dataRecord.longitude = entryWithCoords.lng ?? null;

          zipData[zipCode] = dataRecord;

          const metric = getMetricValue(dataRecord, selectedMetric);
          if (metric > 0) metricValues.push(metric);

          if (i % BATCH_SIZE === 0) {
            self.postMessage({
              type: "PROGRESS",
              data: { phase: "Reconstructing ZIP data...", processed: i, total: zipCodes.length },
            });
          }
        }

        const bounds = computeQuantileBounds5_95(metricValues);
        console.log(`[Worker] Data processed: ${Object.keys(zipData).length} ZIPs, bounds:`, bounds);

        self.postMessage({ type: "DATA_PROCESSED", id, data: { zip_codes: zipData, last_updated_utc, bounds } });
        break;
      }
    }
  } catch (err) {
    if (signal.aborted) {
      abortCurrent();
    } else {
      const errMessage = err instanceof Error ? err.message : "Unknown error";
      const errorType = type || "UNKNOWN";
      console.error("[Worker] Error:", err);
      self.postMessage({
        type: "ERROR",
        id,
        error: `Worker ${errorType} error: ${errMessage}`,
      });
    }
  }
};
