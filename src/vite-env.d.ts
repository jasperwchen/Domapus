/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Data directory URL. Always set by vite.config.ts; overridden for PR previews. */
  readonly VITE_DATA_BASE: string;
}

interface Window {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dataLayer: any[];
}
