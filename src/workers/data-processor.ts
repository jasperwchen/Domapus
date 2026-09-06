// The worker's only remaining job is JSON.parse and a transpose into typed arrays.
//
// It used to build 33,771 plain objects and structured-clone them to the main
// thread, which measured 173 ms of object construction plus 238 ms of clone. Now
// it converts each column to an Int32Array in one pass and posts with a TRANSFER
// LIST, so the buffers move rather than copy: one message, zero copies, no object
// graph. The snapshot is also off the critical path entirely — the paint table
// colours the map before this finishes.
//
// No DecompressionStream and no pre-compressed file. GitHub Pages/Fastly already
// gzips application/json, verified live; a second layer would only add bytes.

import { isSnapshotPayload, type SnapshotHeader } from "../lib/snapshot";
import type { LoadSnapshotRequest, WorkerMessage } from "./worker-types";

let currentAbortController: AbortController | null = null;

self.onmessage = async (e: MessageEvent<WorkerMessage>) => {
  const { id, type, data } = e.data;

  if (currentAbortController) currentAbortController.abort("superseded");
  currentAbortController = new AbortController();
  const signal = currentAbortController.signal;

  // Each invocation owns its own id. When a later message aborts this one, the
  // ABORTED reply must carry THIS id — the caller keys pending promises by id,
  // and replying with the newer id would settle the wrong request.
  const abortCurrent = () => self.postMessage({ type: "ABORTED", id });

  try {
    if (type !== "LOAD_SNAPSHOT") throw new Error(`unknown worker request ${type}`);
    const { url, prefetchedBuffer } = data as LoadSnapshotRequest;

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
        }
        if (response.status >= 500) {
          throw new Error("Server error. Please try again later.");
        }
        throw new Error(`Failed to load data (${response.status}). Please try refreshing.`);
      }
      buffer = await response.arrayBuffer();
      if (buffer.byteLength < 100) {
        throw new Error("Received incomplete data. Please check your connection and try again.");
      }
    }

    const text = new TextDecoder().decode(buffer);

    // A real failure mode this repo has hit: the archive was tracked with Git LFS
    // and a checkout without LFS serves the pointer file, which parses as neither
    // JSON nor an error anyone can read.
    if (text.startsWith("version https://git-lfs.github.com")) {
      throw new Error(
        "Data file not available. The server returned a Git LFS placeholder " +
          "instead of the actual data.",
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown error";
      throw new Error(`JSON parse error: the data file looks corrupt or truncated (${msg})`);
    }

    if (!isSnapshotPayload(payload)) {
      throw new Error(
        "Invalid data format: expected a domapus-snapshot envelope with f, z and d.",
      );
    }

    const { d, ...rest } = payload;
    const header = rest as SnapshotHeader;

    if (d.length !== header.f.length) {
      throw new Error(`Snapshot is malformed: ${d.length} columns for ${header.f.length} names`);
    }

    self.postMessage({ type: "PROGRESS", data: { phase: "Building columns..." } });

    const buffers: Record<string, ArrayBuffer> = {};
    for (let j = 0; j < header.f.length; j++) {
      if (signal.aborted) {
        abortCurrent();
        return;
      }
      const src = d[j];
      if (src.length !== header.z.length) {
        throw new Error(
          `Snapshot is malformed: column ${header.f[j]} has ${src.length} values ` +
            `for ${header.z.length} ZIPs`,
        );
      }
      // One pass, no per-value branching: the null sentinel IS an int32, so nulls
      // need no special case here and stay distinguishable from a real 0.
      const col = new Int32Array(src.length);
      for (let i = 0; i < src.length; i++) col[i] = src[i];
      buffers[header.f[j]] = col.buffer;

      if (j % 8 === 0) {
        self.postMessage({
          type: "PROGRESS",
          data: { phase: "Building columns...", processed: j, total: header.f.length },
        });
      }
    }

    // The transfer list is what makes this free: the column buffers MOVE to the
    // main thread instead of being copied, which is the 238 ms structured clone
    // this format change exists to delete.
    (self as unknown as {
      postMessage(message: unknown, transfer: Transferable[]): void;
    }).postMessage(
      { type: "SNAPSHOT_READY", id, data: { header, buffers, bytes: buffer.byteLength } },
      Object.values(buffers),
    );
  } catch (err) {
    if (signal.aborted) {
      abortCurrent();
    } else {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[Worker] Error:", err);
      self.postMessage({ type: "ERROR", id, error: `Worker ${type || "UNKNOWN"} error: ${msg}` });
    }
  }
};
