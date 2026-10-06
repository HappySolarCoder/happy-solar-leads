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
