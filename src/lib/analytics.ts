export const trackError = (category: string, message: string) => {
  if (typeof window !== 'undefined') {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push({
      event: "app_error",
      error_details: {
        category,
        message: message.substring(0, 100),
        timestamp: new Date().toISOString(),
      }
    });
  }
};

const PARAM_KEYS = [
  "metric", "state", "metro", "method", "search_type", "search_term",
  "found", "enabled", "has_zip", "has_view", "value_ms", "embed_host",
] as const;

type Params = Partial<Record<(typeof PARAM_KEYS)[number], string | number | boolean>>;

// Tag Manager's data layer keeps a key's last value until something overwrites it, so each
// push clears every key it does not set. Otherwise a zip_select sent after a metric_change
// would report that earlier event's metric. Add a key here before sending it.
export function track(event: string, params: Params = {}): void {
  if (typeof window === "undefined") return;
  const cleared = Object.fromEntries(PARAM_KEYS.map((k) => [k, undefined]));
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...cleared, ...params });
}

const sent = new Set<string>();

/** Once per page load. The dashboard remounts on Back out of the methodology route. */
export function trackOnce(event: string, params?: Params): void {
  if (sent.has(event)) return;
  sent.add(event);
  track(event, params);
}
