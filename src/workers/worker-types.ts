import { ZipData } from "../components/dashboard/map/types";

export interface WorkerMessage {
  id: string;
  type: "LOAD_AND_PROCESS_DATA";
  data: LoadDataRequest;
}

export interface WorkerResponse {
  id?: string;
  type: "PROGRESS" | "ERROR" | "DATA_PROCESSED" | "ABORTED";
  data?: DataProcessedResponse | ProgressData;
  error?: string;
}

export interface LoadDataRequest {
  url: string;
  selectedMetric: string;
  prefetchedBuffer?: ArrayBuffer;
}

export interface DataProcessedResponse {
  zip_codes: Record<string, ZipData>;
  last_updated_utc: string;
  bounds: { min: number; max: number };
}

export interface ProgressData {
  phase: string;
  processed?: number;
  total?: number;
}
