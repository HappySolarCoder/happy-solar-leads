import { NextRequest } from 'next/server';
import { routePost } from '@/app/utils/server/googleProxy';
import { liveGoogleProxyDeps } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';

export const POST = (request: NextRequest) => routePost(request, liveGoogleProxyDeps());
