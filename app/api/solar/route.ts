import { proxyPreflight } from '@/app/utils/server/googleProxy';
import { solarPostLive } from '@/app/utils/server/googleProxyLive';

export const runtime = 'nodejs';

// The Google key is server-side only. A body `apiKey` is ignored.
export const POST = solarPostLive;
export const OPTIONS = proxyPreflight;
