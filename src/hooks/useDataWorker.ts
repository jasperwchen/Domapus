import { useState, useEffect, useRef, useCallback } from "react";
import DataProcessorWorker from '@/workers/data-processor.ts?worker';
import { trackError } from "@/lib/analytics";
import { LoadSnapshotRequest, SnapshotReadyResponse, ProgressData } from "@/workers/worker-types";

interface PendingRequest {
  resolve: (value: SnapshotReadyResponse) => void;
  reject: (reason?: Error) => void;
}

/** No phase means nothing is in flight. MapLibreMap renders the overlay on the
 *  phase string alone, so a phase left behind by a finished load is an overlay
 *  that never goes away. */
const IDLE: ProgressData = { phase: '' };

export function useDataWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressData>(IDLE);

  const requestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const isInitializedRef = useRef(false);

  // Every terminal state goes through here. Clearing `isLoading` without also
  // clearing the phase left "Building columns..." on screen for the life of the
  // page, on an ordinary cold load as much as anywhere else.
  const settle = useCallback(() => {
    setIsLoading(false);
    setProgress(IDLE);
  }, []);

  useEffect(() => {
    if (isInitializedRef.current) return;
    const worker = new DataProcessorWorker();
    workerRef.current = worker;
    isInitializedRef.current = true;

    worker.onmessage = (event: MessageEvent) => {
      const { id, type, data, error } = event.data;

      switch (type) {
        case 'PROGRESS':
          setProgress(data as ProgressData);
          break;

        case 'ABORTED': {
          settle();
          const aborted = requestsRef.current.get(id);
          if (aborted) {
            aborted.reject(new DOMException('Request superseded', 'AbortError'));
            requestsRef.current.delete(id);
          }
          break;
        }

        case 'ERROR': {
          console.error('[useDataWorker] Worker error:', error);
          trackError("worker_error", error || "Unknown worker error");
          settle();
          const pending = requestsRef.current.get(id);
          if (pending) {
            pending.reject(new Error(error));
            requestsRef.current.delete(id);
          }
          break;
        }

        default: {
          settle();
          const pending = requestsRef.current.get(id);
          if (pending) {
            pending.resolve(data as SnapshotReadyResponse);
            requestsRef.current.delete(id);
          }
          break;
        }
      }
    };

    worker.onerror = (err: ErrorEvent) => {
      console.error("[useDataWorker] Unhandled worker error:", err);
      trackError("worker_unhandled_error", err?.message || "Unhandled worker error");
      settle();
      requestsRef.current.forEach(request => request.reject(new Error(err.message)));
      requestsRef.current.clear();
    };

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
      isInitializedRef.current = false;
    };
  }, [settle]);

  const processData = useCallback((message: { type: string; data?: LoadSnapshotRequest }, options: { timeout?: number; retries?: number; transfer?: Transferable[] } = {}): Promise<SnapshotReadyResponse> => {
    const { timeout = 30000, retries = 2, transfer = [] } = options;
    const worker = workerRef.current;

    if (!worker || !isInitializedRef.current) {
      console.error("[useDataWorker] Worker not available");
      trackError("worker_not_available", "Worker is not initialized");
      return Promise.reject(new Error("Worker is not initialized"));
    }

    const attemptRequest = async (attempt: number): Promise<SnapshotReadyResponse> => {
      return new Promise((resolve, reject) => {
        const id = `${Date.now()}-${Math.random()}`;

        const timeoutId = setTimeout(() => {
          if (requestsRef.current.has(id)) {
            requestsRef.current.delete(id);
            settle();
            reject(new Error("Request timed out"));
            trackError("worker_timeout", `Request ${message.type} timed out`);
          }
        }, timeout);

        requestsRef.current.set(id, {
          resolve: (data) => {
            clearTimeout(timeoutId);
            resolve(data);
          },
          reject: async (err) => {
            clearTimeout(timeoutId);
            if (attempt < retries && (err?.message?.includes("fetch") || err?.message?.includes("network"))) {
              console.warn(`[useDataWorker] Retry ${attempt + 1}/${retries} for ${message.type}`);
              try {
                // Exponential backoff
                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                const result = await attemptRequest(attempt + 1);
                resolve(result);
              } catch (retryErr) {
                const retryErrMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
                trackError("worker_retry_failed", `Retry ${attempt + 1}/${retries} failed for ${message.type}: ${retryErrMsg}`);
                reject(retryErr instanceof Error ? retryErr : new Error(String(retryErr)));
              }
            } else {
              reject(err);
            }
          }
        });

        setIsLoading(true);
        try {
          worker.postMessage({ id, ...message }, transfer);
        } catch (err) {
          // postMessage rejects a detached ArrayBuffer synchronously, after the
          // loading flag is already up. Without this the promise rejects and the
          // overlay stays forever, which reads as a hang rather than a failure.
          requestsRef.current.delete(id);
          clearTimeout(timeoutId);
          settle();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
    };

    return attemptRequest(0);
  }, [settle]);

  return { processData, isLoading, progress };
}
