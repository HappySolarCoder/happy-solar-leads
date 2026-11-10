import { NextRequest } from 'next/server';
import { geocodeGet, geocodePost } from '@/app/utils/server/googleProxy';
import { liveGoogleProxyDeps } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';

// GET: reverse (lat/lng -> address) or forward (address -> results). POST: forward geocode of one address.
// Auth: see app/utils/server/googleProxy.ts (log-only by default, GOOGLE_PROXY_AUTH=enforce to require a Firebase bearer).
export const GET = (request: NextRequest) => geocodeGet(request, liveGoogleProxyDeps());
export const POST = (request: NextRequest) => geocodePost(request, liveGoogleProxyDeps());
