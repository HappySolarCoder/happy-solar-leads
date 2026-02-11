'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { MapPin, BarChart3, Lightbulb, LogOut, Menu, Users, Settings } from 'lucide-react';
import { getCurrentAuthUser, signOut } from '@/app/utils/auth';
import { User, canAssignLeads, canManageUsers } from '@/app/types';

export default function MobilePage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadUser() {
      const user = await getCurrentAuthUser();
      if (!user) {
        // Not authenticated - redirect to login
        router.push('/login');
      } else {
        setCurrentUser(user);
      }
      setIsLoading(false);
    }
    loadUser();
  }, [router]);

  const handleLogout = async () => {
    await signOut();
    router.push('/login');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-6 py-4">
        <div className="flex items-center justify-between">
          <img
            src="/raydar-horizontal.png"
            alt="Raydar"
            className="h-10 w-auto object-contain"
          />
          <button
            onClick={handleLogout}
            className="p-2 text-[#718096] hover:text-[#FF5F5A] transition-colors"
          >
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        {/* Welcome */}
        <div className="text-center mb-12">
          <h1 className="text-3xl font-bold text-[#2D3748] mb-2">
            Welcome back, {currentUser?.name}
          </h1>
          <p className="text-[#718096]">
            {currentUser?.role === 'setter' || currentUser?.role === 'closer' 
              ? 'Ready to knock some doors?' 
              : 'Manage your team'}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="w-full max-w-sm space-y-4">
          {/* Start Knocking - Primary Action */}
          <button
            onClick={() => router.push('/mobile/knocking')}
            className="w-full bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-200 active:scale-98"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center">
                <MapPin className="w-8 h-8" />
              </div>
              <div>
                <div className="text-2xl font-bold">Start Knocking</div>
                <div className="text-sm text-white/80 mt-1">View leads on map</div>
              </div>
            </div>
          </button>

          {/* Admin Settings - Only for Admins */}
          {currentUser && canManageUsers(currentUser.role) && (
            <button
              onClick={() => router.push('/admin/settings')}
              className="w-full bg-[#4299E1] text-white rounded-2xl p-6 shadow-md hover:shadow-lg transition-all duration-200 active:scale-98"
            >
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-white/20 rounded-xl flex items-center justify-center flex-shrink-0">
                  <Settings className="w-6 h-6" />
                </div>
                <div className="text-left">
                  <div className="text-lg font-bold">Admin Settings</div>
                  <div className="text-sm text-white/80">Configure notifications</div>
                </div>
              </div>
            </button>
          )}

          {/* Data - Coming Soon */}
          <button
            disabled
            className="w-full bg-[#F7FAFC] border-2 border-[#E2E8F0] text-[#718096] rounded-2xl p-6 relative overflow-hidden"
          >
            <div className="absolute top-2 right-2">
              <span className="text-xs font-semibold bg-[#E2E8F0] text-[#718096] px-2 py-1 rounded-full">
                Coming Soon
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#E2E8F0] rounded-xl flex items-center justify-center flex-shrink-0">
                <BarChart3 className="w-6 h-6" />
              </div>
              <div className="text-left">
                <div className="text-lg font-bold text-[#2D3748]">My Data</div>
                <div className="text-sm text-[#718096]">Performance stats</div>
              </div>
            </div>
          </button>

          {/* AI Tips - Coming Soon */}
          <button
            disabled
            className="w-full bg-[#F7FAFC] border-2 border-[#E2E8F0] text-[#718096] rounded-2xl p-6 relative overflow-hidden"
          >
            <div className="absolute top-2 right-2">
              <span className="text-xs font-semibold bg-[#E2E8F0] text-[#718096] px-2 py-1 rounded-full">
                Coming Soon
              </span>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-[#E2E8F0] rounded-xl flex items-center justify-center flex-shrink-0">
                <Lightbulb className="w-6 h-6" />
              </div>
              <div className="text-left">
                <div className="text-lg font-bold text-[#2D3748]">AI Tips</div>
                <div className="text-sm text-[#718096]">Personalized coaching</div>
              </div>
            </div>
          </button>
        </div>

        {/* Desktop Link */}
        <div className="mt-12 text-center">
          <button
            onClick={() => router.push('/')}
            className="text-sm text-[#718096] hover:text-[#FF5F5A] transition-colors flex items-center gap-2 mx-auto"
          >
            <Menu className="w-4 h-4" />
            Switch to Desktop View
          </button>
        </div>
      </main>

      {/* Footer */}
      <footer className="bg-[#F7FAFC] border-t border-[#E2E8F0] px-6 py-4 text-center">
        <p className="text-xs text-[#718096]">
          Raydar &copy; 2026 • Door-knocking made simple
        </p>
      </footer>
    </div>
  );
}
