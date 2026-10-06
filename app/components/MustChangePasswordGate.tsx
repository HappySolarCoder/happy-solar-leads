'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthChange } from '@/app/utils/auth';

/**
 * Sends a signed-in user with mustChangePassword to /change-password
 * before the rest of the app is usable. Does not alter map, knocking, or lead flows.
 */
export default function MustChangePasswordGate() {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      if (user?.mustChangePassword !== true) return;
      if (pathname === '/change-password') return;
      router.replace('/change-password');
    });
    return unsubscribe;
  }, [pathname, router]);

  return null;
}
