/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  readonly VITE_TURNSTILE_SITE_KEY?: string;
  readonly VITE_API_BASE?: string;
}
