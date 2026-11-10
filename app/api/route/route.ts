import { NextRequest } from 'next/server';
import { routePost } from '@/app/utils/server/googleProxy';
import { liveGoogleProxyDeps } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';
// Up to 1500 stops = 60 Routes API calls, four at a time.
export const maxDuration = 60;

export const POST = (request: NextRequest) => routePost(request, liveGoogleProxyDeps());
