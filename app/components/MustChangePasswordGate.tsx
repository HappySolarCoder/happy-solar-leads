'use client';

import { useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { onAuthChange } from '@/app/utils/auth';

/**
 * Sends a signed-in user with mustChangePassword to /change-password
 * before the rest of the app is usable. Does not alter map, knocking, or lead flows.
 * Subscribes once per page load, so it adds one profile read per load, not per navigation.
 */
export default function MustChangePasswordGate() {
  const pathname = usePathname();
  const router = useRouter();
  const mustChange = useRef(false);
  const pathRef = useRef(pathname);

  useEffect(() => {
    pathRef.current = pathname;
    if (mustChange.current && pathname !== '/change-password') router.replace('/change-password');
  }, [pathname, router]);

  useEffect(() => {
    const unsubscribe = onAuthChange((user) => {
      mustChange.current = user?.mustChangePassword === true;
      if (!mustChange.current) return;
      if (pathRef.current === '/change-password') return;
      router.replace('/change-password');
    });
    return unsubscribe;
  }, [router]);

  return null;
}
