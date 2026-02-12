'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  TrendingUp, DoorClosed, Calendar, DollarSign, Target,
  Users, Clock, CheckCircle, ArrowLeft, BarChart3
} from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads } from '@/app/types';
import ActivityStream from '@/app/components/ActivityStream';

export default function DashboardPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }

      setCurrentUser(user);

      const allLeads = await getLeadsAsync();
      const allUsers = await getUsersAsync();
      
      setLeads(allLeads);
      setUsers(allUsers);
      setIsLoading(false);
    }
    loadData();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  // Filter leads based on user role
  const visibleLeads = canSeeAllLeads(currentUser.role)
    ? leads
    : leads.filter(l => 
        l.status === 'unclaimed' || 
        l.claimedBy === currentUser.id || 
        l.assignedTo === currentUser.id
      );

  // Get today's date (start of day)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Calculate daily stats
  const todayLeads = visibleLeads.filter(l => {
    if (!l.dispositionedAt) return false;
    const dispDate = new Date(l.dispositionedAt);
    dispDate.setHours(0, 0, 0, 0);
    return dispDate.getTime() === today.getTime();
  });

  // Count by disposition for today
  const todayKnocks = todayLeads.filter(l => {
    // Check if disposition counts as door knock
    return l.status !== 'unclaimed' && l.status !== 'claimed';
  }).length;

  const todayAppointments = todayLeads.filter(l => l.status === 'appointment').length;
  const todaySales = todayLeads.filter(l => l.status === 'sale').length;
  const todayInterested = todayLeads.filter(l => l.status === 'interested').length;

  // Overall stats
  const totalLeads = visibleLeads.length;
  const available = visibleLeads.filter(l => l.status === 'unclaimed').length;
  const myLeads = visibleLeads.filter(l => l.claimedBy === currentUser.id).length;
  const totalAppointments = visibleLeads.filter(l => l.status === 'appointment').length;
  const totalSales = visibleLeads.filter(l => l.status === 'sale').length;

  // Active setters (claimed leads today)
  const activeSetterIds = new Set(
    todayLeads.map(l => l.claimedBy).filter(Boolean)
  );
  const activeSetters = users.filter(u => activeSetterIds.has(u.id));

  // Calculate conversion rates
  const appointmentRate = todayKnocks > 0 ? ((todayAppointments / todayKnocks) * 100).toFixed(1) : '0.0';
  const closeRate = todayAppointments > 0 ? ((todaySales / todayAppointments) * 100).toFixed(1) : '0.0';

  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => router.push('/')}
              className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5 text-[#718096]" />
            </button>
            <div>
              <h1 className="text-2xl font-bold text-[#2D3748]">Daily Dashboard</h1>
              <p className="text-sm text-[#718096]">
                {today.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>
          <img
            src="/raydar-icon.png"
            alt="Raydar"
            className="h-10 w-10"
          />
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Today's Stats */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <Clock className="w-5 h-5 text-[#FF5F5A]" />
            Today's Activity
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Doors Knocked */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#FF5F5A]/10 rounded-xl">
                  <DoorClosed className="w-6 h-6 text-[#FF5F5A]" />
                </div>
                <TrendingUp className="w-5 h-5 text-[#48BB78]" />
              </div>
              <div className="text-3xl font-bold text-[#2D3748] mb-1">{todayKnocks}</div>
              <div className="text-sm text-[#718096]">Doors Knocked</div>
            </div>

            {/* Appointments Set */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-blue-100 rounded-xl">
                  <Calendar className="w-6 h-6 text-blue-600" />
                </div>
                <span className="text-xs font-semibold text-blue-600 bg-blue-100 px-2 py-1 rounded-full">
                  {appointmentRate}%
                </span>
              </div>
              <div className="text-3xl font-bold text-[#2D3748] mb-1">{todayAppointments}</div>
              <div className="text-sm text-[#718096]">Appointments Set</div>
            </div>

            {/* Sales */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-green-100 rounded-xl">
                  <DollarSign className="w-6 h-6 text-green-600" />
                </div>
                <span className="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">
                  {closeRate}%
                </span>
              </div>
              <div className="text-3xl font-bold text-[#2D3748] mb-1">{todaySales}</div>
              <div className="text-sm text-[#718096]">Sales Closed</div>
            </div>

            {/* Interested */}
            <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-amber-100 rounded-xl">
                  <Target className="w-6 h-6 text-amber-600" />
                </div>
              </div>
              <div className="text-3xl font-bold text-[#2D3748] mb-1">{todayInterested}</div>
              <div className="text-sm text-[#718096]">Interested Leads</div>
            </div>
          </div>
        </div>

        {/* Overall Stats */}
        <div className="mb-8">
          <h2 className="text-lg font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-[#FF5F5A]" />
            Overall Stats
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            {/* Total Leads */}
            <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-2xl font-bold text-[#2D3748] mb-1">{totalLeads}</div>
              <div className="text-xs text-[#718096]">Total Leads</div>
            </div>

            {/* Available */}
            <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-2xl font-bold text-[#FF5F5A] mb-1">{available}</div>
              <div className="text-xs text-[#718096]">Available</div>
            </div>

            {/* My Leads */}
            <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-2xl font-bold text-[#2D3748] mb-1">{myLeads}</div>
              <div className="text-xs text-[#718096]">My Leads</div>
            </div>

            {/* Total Appointments */}
            <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-2xl font-bold text-blue-600 mb-1">{totalAppointments}</div>
              <div className="text-xs text-[#718096]">Total Appts</div>
            </div>

            {/* Total Sales */}
            <div className="bg-[#F7FAFC] border border-[#E2E8F0] rounded-xl p-4">
              <div className="text-2xl font-bold text-green-600 mb-1">{totalSales}</div>
              <div className="text-xs text-[#718096]">Total Sales</div>
            </div>
          </div>
        </div>

        {/* Activity Stream */}
        <div className="mb-8">
          <ActivityStream />
        </div>

        {/* Active Team Members */}
        {canSeeAllLeads(currentUser.role) && activeSetters.length > 0 && (
          <div>
            <h2 className="text-lg font-bold text-[#2D3748] mb-4 flex items-center gap-2">
              <Users className="w-5 h-5 text-[#FF5F5A]" />
              Active Today ({activeSetters.length})
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeSetters.map(setter => {
                const setterLeads = todayLeads.filter(l => l.claimedBy === setter.id);
                const setterKnocks = setterLeads.length;
                const setterAppts = setterLeads.filter(l => l.status === 'appointment').length;
                const setterSales = setterLeads.filter(l => l.status === 'sale').length;

                return (
                  <div key={setter.id} className="bg-white border border-[#E2E8F0] rounded-xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold"
                        style={{ backgroundColor: setter.color }}
                      >
                        {setter.name.charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1">
                        <div className="font-semibold text-[#2D3748]">{setter.name}</div>
                        <div className="text-xs text-[#718096] capitalize">{setter.role}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div>
                        <div className="font-semibold text-[#2D3748]">{setterKnocks}</div>
                        <div className="text-xs text-[#718096]">Knocks</div>
                      </div>
                      <div>
                        <div className="font-semibold text-blue-600">{setterAppts}</div>
                        <div className="text-xs text-[#718096]">Appts</div>
                      </div>
                      <div>
                        <div className="font-semibold text-green-600">{setterSales}</div>
                        <div className="text-xs text-[#718096]">Sales</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
