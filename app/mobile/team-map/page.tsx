'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Users, RefreshCw } from 'lucide-react';
import { getCurrentUserAsync, getUsersAsync } from '@/app/utils/storage';
import { User, canAssignLeads } from '@/app/types';

// This will show real-time team locations on map
// For now it's a placeholder - will need WebSocket/Firebase Realtime for true live tracking

const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F7FAFC]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-[#718096]">Loading map...</p>
      </div>
    </div>
  ),
});

export default function TeamMapPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentUserAsync();
      if (!user || !canAssignLeads(user.role)) {
        // Only managers and admins can see team map
        router.push('/mobile');
        return;
      }
      setCurrentUser(user);

      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      setIsLoading(false);
    }
    loadData();
  }, [router]);

  const activeUsers = users.filter(u => u.isActive !== false);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading team...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/mobile')}
            className="p-2 -ml-2 text-[#718096] hover:text-[#FF5F5A] active:scale-95 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-[#FF5F5A]" />
            <h1 className="font-bold text-[#2D3748]">Team Locations</h1>
          </div>

          <button
            onClick={() => window.location.reload()}
            className="p-2 text-[#718096] hover:text-[#FF5F5A] active:scale-95 transition-all"
          >
            <RefreshCw className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Team List */}
      <div className="bg-[#F7FAFC] border-b border-[#E2E8F0] px-4 py-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-[#2D3748]">Active Team Members</span>
          <span className="text-xs text-[#718096]">{activeUsers.length} online</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {activeUsers.map(user => (
            <div
              key={user.id}
              className="flex items-center gap-2 px-3 py-1.5 bg-white border border-[#E2E8F0] rounded-full text-xs"
            >
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: user.color }}
              />
              <span className="font-medium text-[#2D3748]">{user.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Coming Soon Notice */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center max-w-md">
          <div className="w-20 h-20 bg-[#FF5F5A]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <Users className="w-10 h-10 text-[#FF5F5A]" />
          </div>
          <h2 className="text-xl font-bold text-[#2D3748] mb-2">
            Real-Time Team Tracking
          </h2>
          <p className="text-[#718096] mb-6">
            Live team location tracking requires WebSocket or Firebase Realtime Database integration. This feature will show all active setters on the map in real-time.
          </p>
          <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4 text-left">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-3">Planned Features:</h3>
            <ul className="space-y-2 text-sm text-[#718096]">
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>See all team members' live GPS positions</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Coverage heatmap showing knocked areas</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Team member activity status (knocking, break, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Distance between team members</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Historical tracking (where they've been today)</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
