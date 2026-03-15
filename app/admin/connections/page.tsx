'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, MessageSquare, Settings, Link as LinkIcon } from 'lucide-react';
import { canManageUsers, User } from '@/app/types';
import { getCurrentAuthUser } from '@/app/utils/auth';

export default function AdminConnectionsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function load() {
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
        setCurrentUser(user);
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading connections...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-[#718096] hover:text-[#2D3748] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
          <div className="mt-4 flex items-center gap-4">
            <div className="p-3 bg-[#4299E1]/10 rounded-lg">
              <LinkIcon className="w-7 h-7 text-[#4299E1]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-[#2D3748]">Connections</h1>
              <p className="text-sm text-[#718096]">Manage integrations like Discord webhooks and notification endpoints</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <button
            onClick={() => router.push('/admin/settings')}
            className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#4299E1] hover:shadow-md transition-all text-left group"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="p-3 bg-[#4299E1]/10 rounded-lg">
                <MessageSquare className="w-6 h-6 text-[#4299E1]" />
              </div>
              <Settings className="w-5 h-5 text-[#718096] group-hover:text-[#4299E1] transition-colors" />
            </div>
            <h3 className="font-semibold text-[#2D3748] mb-1">Notifications & Webhooks</h3>
            <p className="text-sm text-[#718096]">
              Configure Discord / Google Chat / Slack webhooks (Scheduling Manager alerts)
            </p>
          </button>
        </div>
      </main>
    </div>
  );
}
