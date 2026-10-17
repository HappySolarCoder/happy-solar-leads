'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { canManageUsers } from '@/app/types';
import { getCurrentAuthUser } from '@/app/utils/auth';

export default function AdminSettingsPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function loadData() {
      try {
        const user = await getCurrentAuthUser();
        if (!user) {
          router.push('/login');
          return;
        }
        if (!canManageUsers(user.role)) {
          router.push('/');
          return;
        }
        if (!cancelled) setReady(true);
      } catch (error) {
        console.error('Settings page load error:', error);
        router.push('/');
      }
    }
    loadData();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
          <p className="text-sm text-[#718096]">Loading settings...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-[#718096] hover:text-[#2D3748] mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
          <h1 className="text-3xl font-bold text-[#2D3748]">Admin Settings</h1>
          <p className="text-[#718096] mt-2">Scheduling notifications are managed on the server.</p>
        </div>
      </div>
    </div>
  );
}
