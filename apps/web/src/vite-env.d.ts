/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MQTT_URL?: string;
  readonly VITE_MQTT_URL_SECURE?: string;
  readonly VITE_MQTT_USERNAME?: string;
  readonly VITE_MQTT_PASSWORD?: string;
  readonly VITE_DEVICE_ID?: string;
  readonly VITE_LOCATION_LAT?: string;
  readonly VITE_LOCATION_LNG?: string;
  /** The hub API (A4): normally `/api`, same origin. */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** The build (commit and date), defined by vite.config.ts. */
declare const __APP_BUILD__: string;
