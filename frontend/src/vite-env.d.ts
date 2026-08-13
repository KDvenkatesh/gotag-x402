/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_ALGOD_SERVER?: string;
  readonly VITE_GTUSD_ASSET_ID?: string;
  readonly VITE_SETTLEMENT_AUTHORITY?: string;
  readonly VITE_APP_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
