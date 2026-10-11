export const PRODUCTION_API_ORIGIN = 'https://happy-solar-leads.vercel.app';
export const PRODUCTION_FIREBASE_PROJECT = 'gen-lang-client-0395385938';
/** Fail the real mobile build before export if it targets another backend/project. */
export function assertProductionConfig(env) {
  const expected = {
    NEXT_PUBLIC_API_BASE_URL: PRODUCTION_API_ORIGIN,
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: PRODUCTION_FIREBASE_PROJECT,
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: `${PRODUCTION_FIREBASE_PROJECT}.firebaseapp.com`,
  };
  for (const [name, value] of Object.entries(expected)) {
    if (env[name] !== value) throw Error(`${name} must be ${value} for the production Raydar mobile build.`);
  }
  if (!env.NEXT_PUBLIC_FIREBASE_API_KEY || !/^1:143988544112:web:[\w-]+$/.test(env.NEXT_PUBLIC_FIREBASE_APP_ID || ''))
    throw Error('Use the production Firebase web app configuration for project gen-lang-client-0395385938.');
}
