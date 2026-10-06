import ChangePasswordClient from './ChangePasswordClient';

export default async function ChangePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ preview?: string | string[] }>;
}) {
  const params = await searchParams;
  const preview = Array.isArray(params.preview) ? params.preview[0] : params.preview;
  // Production ignores this. Preview and local builds can open the forced
  // screen without creating a Firebase user. Saving still requires a session.
  const allowForcedPreview = process.env.VERCEL_ENV !== 'production' && preview === 'forced';
  return <ChangePasswordClient allowForcedPreview={allowForcedPreview} />;
}
