/** Default scheduling-manager number when admin settings are missing or not loaded yet. */
export const FALLBACK_SCHEDULING_MANAGER_PHONE = '(716) 272-9889';

/**
 * Digits for a `tel:` URL. Missing or non-numeric input uses the fallback number.
 * Kept synchronous so the dialer can open inside the tap gesture.
 */
export function schedulingManagerTelDigits(phone: string | null | undefined): string {
  const fallbackDigits = FALLBACK_SCHEDULING_MANAGER_PHONE.replace(/\D/g, '');
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits || fallbackDigits;
}
