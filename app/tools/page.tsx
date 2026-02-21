'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Calendar, Map, Users, BarChart3, Settings, ShieldCheck } from 'lucide-react';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { User } from '@/app/types';
import { getLeadsAsync } from '@/app/utils/storage';

export default function ToolsPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [goBackCount, setGoBackCount] = useState(0);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      // Get go back count for current user
      const leads = await getLeadsAsync();
      const userGoBacks = leads.filter(lead => 
        lead.status === 'go-back' && 
        lead.goBackScheduledDate &&
        (lead.claimedBy === user.id || lead.goBackScheduledBy === user.id)
      );
      setGoBackCount(userGoBacks.length);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading tools...</p>
        </div>
      </div>
    );
  }

  const isAdmin = currentUser?.role === 'admin';
  const isManager = currentUser?.role === 'manager';
  const isSetter = currentUser?.role === 'setter' || currentUser?.role === 'closer';

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0] sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/mobile/knocking')}
              className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[#718096]" />
            </button>
            <h1 className="text-2xl font-bold text-[#2D3748]">Tools</h1>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Setter Tools (All Roles) */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold text-[#2D3748] mb-4">Field Tools</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Go Backs */}
            <button
              onClick={() => router.push('/go-backs')}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="p-3 bg-[#FEF5E7] rounded-lg group-hover:bg-[#FDE7C5] transition-colors">
                  <Calendar className="w-6 h-6 text-[#FF5F5A]" />
                </div>
                {goBackCount > 0 && (
                  <span className="px-3 py-1 bg-[#FF5F5A] text-white text-sm rounded-full font-medium">
                    {goBackCount}
                  </span>
                )}
              </div>
              <h3 className="text-lg font-semibold text-[#2D3748] mb-1">Go Backs</h3>
              <p className="text-sm text-[#718096]">View and manage scheduled go backs</p>
            </button>

            {/* Team Map */}
            <button
              onClick={() => router.push('/team-map')}
              className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
            >
              <div className="p-3 bg-[#EDF2F7] rounded-lg group-hover:bg-[#E2E8F0] transition-colors mb-3">
                <Map className="w-6 h-6 text-[#4299E1]" />
              </div>
              <h3 className="text-lg font-semibold text-[#2D3748] mb-1">Team Map</h3>
              <p className="text-sm text-[#718096]">See all leads and team activity</p>
            </button>
          </div>
        </div>

        {/* Manager Tools */}
        {(isManager || isAdmin) && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[#2D3748] mb-4">Manager Tools</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Territory Assignment */}
              <button
                onClick={() => router.push('/territories')}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
              >
                <div className="p-3 bg-[#F0FFF4] rounded-lg group-hover:bg-[#C6F6D5] transition-colors mb-3">
                  <Users className="w-6 h-6 text-[#48BB78]" />
                </div>
                <h3 className="text-lg font-semibold text-[#2D3748] mb-1">Territories</h3>
                <p className="text-sm text-[#718096]">Manage territory assignments</p>
              </button>

              {/* Data & Stats */}
              <button
                onClick={() => router.push('/setter-stats')}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
              >
                <div className="p-3 bg-[#FAF5FF] rounded-lg group-hover:bg-[#E9D8FD] transition-colors mb-3">
                  <BarChart3 className="w-6 h-6 text-[#805AD5]" />
                </div>
                <h3 className="text-lg font-semibold text-[#2D3748] mb-1">Team Stats</h3>
                <p className="text-sm text-[#718096]">View setter performance data</p>
              </button>
            </div>
          </div>
        )}

        {/* Admin Tools */}
        {isAdmin && (
          <div className="mb-8">
            <h2 className="text-lg font-semibold text-[#2D3748] mb-4">Admin Tools</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Admin Dashboard */}
              <button
                onClick={() => router.push('/admin')}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
              >
                <div className="p-3 bg-[#FFF5F5] rounded-lg group-hover:bg-[#FED7D7] transition-colors mb-3">
                  <ShieldCheck className="w-6 h-6 text-[#E53E3E]" />
                </div>
                <h3 className="text-lg font-semibold text-[#2D3748] mb-1">Admin Dashboard</h3>
                <p className="text-sm text-[#718096]">Users, roles, settings, and more</p>
              </button>

              {/* System Settings */}
              <button
                onClick={() => router.push('/admin/settings')}
                className="bg-white rounded-lg shadow-sm p-6 hover:shadow-md transition-shadow text-left group"
              >
                <div className="p-3 bg-[#EDF2F7] rounded-lg group-hover:bg-[#E2E8F0] transition-colors mb-3">
                  <Settings className="w-6 h-6 text-[#718096]" />
                </div>
                <h3 className="text-lg font-semibold text-[#2D3748] mb-1">System Settings</h3>
                <p className="text-sm text-[#718096]">Configure app-wide settings</p>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
