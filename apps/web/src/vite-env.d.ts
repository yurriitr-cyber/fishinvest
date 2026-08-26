/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Absolute API origin without trailing slash. Empty = same-origin `/api`. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
