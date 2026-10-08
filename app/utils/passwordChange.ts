export function validatePasswordChange(input: {
  currentPassword: string;
  newPassword: string;
  confirmPassword: string;
}): string | null {
  if (!input.currentPassword) return 'Enter your current password.';
  if (input.newPassword.length < 8) return 'New password must be at least 8 characters.';
  if (input.newPassword !== input.confirmPassword) return 'New password and confirmation do not match.';
  if (input.newPassword === input.currentPassword) return 'New password must be different from your current password.';
  return null;
}

/** Clears only mustChangePassword for the signed-in user. Never touches any other field. */
export async function clearMustChangePassword(options: {
  idToken: string | null;
  verifyIdToken: (token: string) => Promise<{ uid: string }>;
  readFlag: (uid: string) => Promise<boolean | null>;
  clearFlag: (uid: string) => Promise<void>;
}): Promise<{ status: number; body: { ok?: true; error?: string } }> {
  if (!options.idToken) return { status: 401, body: { error: 'Missing credentials' } };
  let uid: string;
  try {
    uid = (await options.verifyIdToken(options.idToken)).uid;
  } catch {
    return { status: 401, body: { error: 'Unauthorized' } };
  }
  const flag = await options.readFlag(uid);
  if (flag === null) return { status: 404, body: { error: 'Profile not found' } };
  if (flag) await options.clearFlag(uid);
  return { status: 200, body: { ok: true } };
}
