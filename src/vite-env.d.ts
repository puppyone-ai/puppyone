/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_UPDATE_PREVIEW?: string;
  readonly VITE_DESKTOP_UPDATE_PREVIEW_VERSION?: string;
  /** Website demo: extra pages allowed to embed it, comma-separated origins. */
  readonly VITE_WEBSITE_DEMO_EMBED_ORIGINS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
