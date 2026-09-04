/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_API_PROXY_TARGET: string;
  readonly VITE_FLEET_API_PROXY_TARGET: string;
  readonly VITE_GPS_API_PROXY_TARGET: string;
  readonly VITE_NOTIFICATION_API_PROXY_TARGET: string;
  readonly VITE_FLEET_SVC_API_PROXY_TARGET: string;
  readonly VITE_APP_TITLE: string;
  readonly VITE_USE_MOCK: string;
  /** gps-engine Socket.IO URL (connects directly — not via the /api proxy). */
  readonly VITE_GPS_WS_URL?: string;
  /** notification-service Socket.IO URL (alarms + notification bell). */
  readonly VITE_NOTIFICATION_WS_URL?: string;
  /** MDVR RTMP ingest advertised to the device (rewritten server-side). */
  readonly VITE_MDVR_PUBLIC_HOST?: string;
  readonly VITE_MDVR_RTMP_PORT?: string;
  /** Same as md300-main `RTMP_PATH` (default live/md300). */
  readonly VITE_MDVR_RTMP_PATH?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
