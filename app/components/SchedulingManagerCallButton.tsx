'use client';

import { useEffect, useState } from 'react';
import { Phone } from 'lucide-react';
import { getAdminSettingsAsync } from '@/app/utils/adminSettings';
import {
  FALLBACK_SCHEDULING_MANAGER_PHONE,
  schedulingManagerTelDigits,
} from '@/app/utils/schedulingManagerTel';

/**
 * The same tel: Call Scheduling Manager control used after Send Info.
 * A plain href keeps the iOS/Android user gesture; do not await before navigation.
 * Capacitor does not need a plugin URL opener for tel links — the existing WKWebView / Android
 * WebView handling of this link is what LeadEditorModal already ships.
 */
export default function SchedulingManagerCallButton({
  className,
  onDialed,
}: {
  className?: string;
  onDialed?: () => void;
}) {
  const [phone, setPhone] = useState(FALLBACK_SCHEDULING_MANAGER_PHONE);

  useEffect(() => {
    let cancelled = false;
    void getAdminSettingsAsync()
      .then((settings) => {
        const next = settings?.schedulingManagerPhone?.trim();
        if (!cancelled && next) setPhone(next);
      })
      .catch(() => {
        // Denied or offline: keep the fallback number. Do not invent a different one.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const href = `tel:${schedulingManagerTelDigits(phone)}`;
  return (
    <a
      href={href}
      onClick={() => onDialed?.()}
      aria-label="Call Scheduling Manager"
      className={className ?? "mt-3 w-full px-4 py-3 bg-[#48BB78] hover:bg-[#38A169] text-white rounded-lg font-semibold no-underline transition-colors flex items-center justify-center gap-2"}
    >
      <Phone className="w-5 h-5" />
      Call Scheduling Manager
    </a>
  );
}
