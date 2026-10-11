import release from './release.json';

export const MOBILE_BUILD_LABEL = `Raydar v${release.version} · build ${release.build}`;

// Deliberately log stages, elapsed time and error codes only. Never log
// credentials, profile/lead records, request URLs, or Firebase tokens.
export function startupEvent(stage: string, startedAt?: number, error?: unknown) {
  if (process.env.NEXT_PUBLIC_NATIVE_BUILD !== '1') return;
  const code = error && typeof error === 'object' && 'code' in error
    ? String(error.code).replace(/[^a-zA-Z0-9/_-]/g, '').slice(0, 80) : '';
  console.info(`[Raydar ${release.version}/${release.build}] ${stage}`,
    startedAt === undefined ? '' : `${Date.now() - startedAt}ms`, code);
}
