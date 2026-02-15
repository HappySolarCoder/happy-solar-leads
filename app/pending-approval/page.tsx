'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { getCurrentAuthUser, signOut } from '@/app/utils/auth';
import { Shield } from 'lucide-react';

export default function PendingApprovalPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [requestedRole, setRequestedRole] = useState<string>('manager');

  useEffect(() => {
    async function load() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (user.approvalStatus !== 'pending') {
        router.push('/');
        return;
      }
      setName(user.name);
      setRequestedRole(user.requestedRole || user.role);
    }
    load();
  }, [router]);

  const handleSignOut = async () => {
    await signOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center px-4">
      <div className="w-full max-w-md bg-white border border-[#E2E8F0] rounded-2xl shadow-sm p-8 text-center">
        <div className="mx-auto w-16 h-16 rounded-full bg-[#FF5F5A]/10 flex items-center justify-center mb-4">
          <Shield className="w-8 h-8 text-[#FF5F5A]" />
        </div>
        <p className="text-sm uppercase tracking-[0.3em] text-[#FF5F5A] font-semibold">
          Pending Approval
        </p>
        <h1 className="text-2xl font-bold text-[#2D3748] mt-3">Hang tight, {name.split(' ')[0] || 'there'}! 👋</h1>
        <p className="text-[#718096] text-sm mt-3 leading-relaxed">
          Your <span className="font-semibold">{requestedRole}</span> access request is waiting for admin approval.
          As soon as it's reviewed, you'll unlock the full Raydar experience.
        </p>
        <div className="mt-6 bg-[#FFF8F5] border border-[#FED7AA] rounded-xl p-4 text-left text-sm text-[#C05621]">
          <p className="font-semibold mb-1">What you can do:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Stand by for approval (typically quick)</li>
            <li>Reach out to your admin if it's urgent</li>
            <li>Come back later — we'll keep checking automatically</li>
          </ul>
        </div>

        <div className="mt-8 flex flex-col gap-3">
          <button
            onClick={() => router.push('/')}
            className="w-full py-3 rounded-lg bg-[#FF5F5A] text-white font-semibold hover:bg-[#E54E49] transition"
          >
            Check Again
          </button>
          <button
            onClick={handleSignOut}
            className="w-full py-3 rounded-lg border border-[#E2E8F0] text-[#2D3748] font-semibold hover:bg-[#F7FAFC] transition"
          >
            Sign Out
          </button>
        </div>
      </div>
    </div>
  );
}
