import { proxyPreflight } from '@/app/utils/server/googleProxy';
import { geocodeGetLive, geocodePostLive } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';

// GET: reverse (lat/lng -> address) or forward (address -> results). POST: forward geocode of one address.
// Auth: see app/utils/server/googleProxy.ts (log-only by default, GOOGLE_PROXY_AUTH=enforce to require a Firebase bearer).
export const GET = geocodeGetLive;
export const POST = geocodePostLive;
export const OPTIONS = proxyPreflight;
