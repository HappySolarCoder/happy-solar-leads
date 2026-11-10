import { NextRequest } from 'next/server';
import { solarPost } from '@/app/utils/server/googleProxy';
import { liveGoogleProxyDeps } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';

// The Google key is server-side only. A body `apiKey` is ignored.
export const POST = (request: NextRequest) => solarPost(request, liveGoogleProxyDeps());
