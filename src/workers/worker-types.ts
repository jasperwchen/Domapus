import type { SnapshotHeader } from "@/lib/snapshot";

export interface WorkerMessage {
  id: string;
  type: "LOAD_SNAPSHOT";
  data: LoadSnapshotRequest;
}

export interface LoadSnapshotRequest {
  url: string;
  /** Started by index.html before the bundle parses, so it is usually in flight. */
  prefetchedBuffer?: ArrayBuffer;
}

export interface WorkerResponse {
  id?: string;
  type: "PROGRESS" | "ERROR" | "SNAPSHOT_READY" | "ABORTED";
  data?: SnapshotReadyResponse | ProgressData;
  error?: string;
}

export interface SnapshotReadyResponse {
  /** Dicts, scales, breaks and the ZIP list. Small, structured-cloned. */
  header: SnapshotHeader;
  /** One Int32Array buffer per column, TRANSFERRED — zero copies. */
  buffers: Record<string, ArrayBuffer>;
  bytes: number;
}

export interface ProgressData {
  phase: string;
  processed?: number;
  total?: number;
}
