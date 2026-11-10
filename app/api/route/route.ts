import { NextRequest } from 'next/server';
import { routePost } from '@/app/utils/server/googleProxy';
import { liveGoogleProxyDeps } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';
// Up to 1500 stops = 60 Routes API calls, four at a time. That is close to this 60 s limit, which is why signed-in
// users get only 60 route requests a minute (DEFAULT_ROUTE_AUTH_LIMIT). Revisit both if RouteBuilder is ever mounted.
export const maxDuration = 60;

export const POST = (request: NextRequest) => routePost(request, liveGoogleProxyDeps());
