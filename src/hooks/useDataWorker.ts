import { useState, useEffect, useRef, useCallback } from "react";
import DataProcessorWorker from '@/workers/data-processor.ts?worker';
import { trackError } from "@/lib/analytics";
import { LoadSnapshotRequest, SnapshotReadyResponse, ProgressData } from "@/workers/worker-types";

interface PendingRequest {
  resolve: (value: SnapshotReadyResponse) => void;
  reject: (reason?: Error) => void;
}

export function useDataWorker() {
  const workerRef = useRef<Worker | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [progress, setProgress] = useState<ProgressData>({ phase: '' });
  const requestsRef = useRef<Map<string, PendingRequest>>(new Map());
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (isInitializedRef.current) return;
    const worker = new DataProcessorWorker();
    workerRef.current = worker;
    isInitializedRef.current = true;
    console.log('[useDataWorker] Worker initialized');

    worker.onmessage = (event: MessageEvent) => {
      const { id, type, data, error } = event.data;

      switch (type) {
        case 'PROGRESS':
          setProgress(data as ProgressData);
          break;

        case 'ABORTED': {
          setIsLoading(false);
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
          setIsLoading(false);
          const pending = requestsRef.current.get(id);
          if (pending) {
            pending.reject(new Error(error));
            requestsRef.current.delete(id);
          }
          break;
        }

        default: {
          console.log(`[useDataWorker] ${type} completed for request ${id}`);
          setIsLoading(false);
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
      setIsLoading(false);
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
  }, []);

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
        worker.postMessage({ id, ...message }, transfer);
      });
    };

    return attemptRequest(0);
  }, []);

  return { processData, isLoading, progress };
}
