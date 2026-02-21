'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Target, DollarSign, Award, ArrowLeft, Users, Calendar, Trophy, BarChart3 } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User } from '@/app/types';
import { startOfToday, startOfWeek, startOfMonth, isAfter, format } from 'date-fns';

interface SetterMetrics {
  userId: string;
  userName: string;
  knocks: number; // dispositioned leads (countsAsDoorKnock)
  conversations: number; // interested + appointment + sale
  appointments: number; // appointment disposition
  sales: number; // sale disposition
  notHome: number;
  notInterested: number;
}

type TimeFilter = 'today' | 'week' | 'month' | 'all';

export default function DataDashboard() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');
  const [sortBy, setSortBy] = useState<'knocks' | 'conversations' | 'appointments' | 'sales'>('knocks');

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      setCurrentUser(user);

      const loadedLeads = await getLeadsAsync();
      const loadedUsers = await getUsersAsync();

      setLeads(loadedLeads);
      setUsers(loadedUsers);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  // Calculate metrics for each setter
  const calculateSetterMetrics = (): SetterMetrics[] => {
    const setterMap = new Map<string, SetterMetrics>();

    // Get time filter cutoff
    let cutoffDate: Date;
    switch (timeFilter) {
      case 'today':
        cutoffDate = startOfToday();
        break;
      case 'week':
        cutoffDate = startOfWeek(new Date());
        break;
      case 'month':
        cutoffDate = startOfMonth(new Date());
        break;
      default:
        cutoffDate = new Date(0); // All time
    }

    // Filter leads by time
    const filteredLeads = leads.filter(lead => {
      if (!lead.dispositionedAt) return false;
      return isAfter(new Date(lead.dispositionedAt), cutoffDate);
    });

    // Process leads
    filteredLeads.forEach(lead => {
      const userId = lead.claimedBy;
      if (!userId) return;

      if (!setterMap.has(userId)) {
        const user = users.find(u => u.id === userId);
        setterMap.set(userId, {
          userId,
          userName: user?.name || 'Unknown',
          knocks: 0,
          conversations: 0,
          appointments: 0,
          sales: 0,
          notHome: 0,
          notInterested: 0,
        });
      }

      const metrics = setterMap.get(userId)!;

      // Count knocks (any disposition that counts as a door knock)
      if (lead.status && ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(lead.status)) {
        metrics.knocks++;
      }

      // Count specific dispositions
      switch (lead.status) {
        case 'not-home':
          metrics.notHome++;
          break;
        case 'not-interested':
          metrics.notInterested++;
          break;
        case 'interested':
          metrics.conversations++;
          break;
        case 'appointment':
          metrics.appointments++;
          metrics.conversations++;
          break;
        case 'sale':
          metrics.sales++;
          metrics.appointments++;
          metrics.conversations++;
          break;
      }
    });

    // Convert to array and sort
    const metricsArray = Array.from(setterMap.values());
    metricsArray.sort((a, b) => b[sortBy] - a[sortBy]);

    return metricsArray;
  };

  const setterMetrics = calculateSetterMetrics();

  // Calculate team totals
  const teamTotals = setterMetrics.reduce(
    (acc, setter) => ({
      knocks: acc.knocks + setter.knocks,
      conversations: acc.conversations + setter.conversations,
      appointments: acc.appointments + setter.appointments,
      sales: acc.sales + setter.sales,
      notHome: acc.notHome + setter.notHome,
      notInterested: acc.notInterested + setter.notInterested,
    }),
    { knocks: 0, conversations: 0, appointments: 0, sales: 0, notHome: 0, notInterested: 0 }
  );

  const calculateRate = (num: number, denom: number) => {
    return denom > 0 ? ((num / denom) * 100).toFixed(1) : '0.0';
  };

  const getPerformanceColor = (rate: number, type: 'conversation' | 'appointment' | 'close') => {
    const thresholds = {
      conversation: { excellent: 40, good: 25 },
      appointment: { excellent: 50, good: 35 },
      close: { excellent: 30, good: 20 },
    };

    const t = thresholds[type];
    if (rate >= t.excellent) return 'bg-green-100 text-green-700';
    if (rate >= t.good) return 'bg-blue-100 text-blue-700';
    return 'bg-yellow-100 text-yellow-700';
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC] p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.push('/tools')}
            className="inline-flex items-center gap-2 text-[#4299E1] hover:text-[#3182CE] mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Tools
          </button>
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[#2D3748] mb-2">Team Performance Dashboard</h1>
              <p className="text-[#718096]">Real-time setter metrics and analytics</p>
            </div>
            
            {/* Time Filter */}
            <div className="flex items-center gap-2 bg-white p-1 rounded-lg shadow-sm">
              {(['today', 'week', 'month', 'all'] as TimeFilter[]).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setTimeFilter(filter)}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    timeFilter === filter
                      ? 'bg-[#FF5F5A] text-white'
                      : 'text-[#718096] hover:text-[#2D3748]'
                  }`}
                >
                  {filter === 'today' ? 'Today' : filter === 'week' ? 'This Week' : filter === 'month' ? 'This Month' : 'All Time'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Team Overview Cards */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Target className="w-4 h-4" />
              <span className="text-sm font-medium">Total Knocks</span>
            </div>
            <div className="text-3xl font-bold text-[#2D3748]">{teamTotals.knocks}</div>
            <div className="text-xs text-[#718096] mt-1">
              {teamTotals.notHome} not home, {teamTotals.notInterested} not interested
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Conversations</span>
            </div>
            <div className="text-3xl font-bold text-[#4299E1]">{teamTotals.conversations}</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.conversations, teamTotals.knocks)}% conversion rate
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Award className="w-4 h-4" />
              <span className="text-sm font-medium">Appointments</span>
            </div>
            <div className="text-3xl font-bold text-[#805AD5]">{teamTotals.appointments}</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.appointments, teamTotals.conversations)}% from conversations
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Sales</span>
            </div>
            <div className="text-3xl font-bold text-[#48BB78]">{teamTotals.sales}</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.sales, teamTotals.appointments)}% close rate
            </div>
          </div>
        </div>

        {/* Funnel Visualization */}
        <div className="bg-white rounded-lg p-6 shadow-sm mb-6">
          <h2 className="text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
            <BarChart3 className="w-5 h-5" />
            Conversion Funnel
          </h2>
          <div className="flex items-center gap-2">
            <div className="flex-1">
              <div className="bg-[#4299E1] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.knocks} Knocks
              </div>
            </div>
            <div className="text-[#718096] text-sm">→</div>
            <div className="flex-1" style={{ flex: teamTotals.knocks > 0 ? teamTotals.conversations / teamTotals.knocks : 0 }}>
              <div className="bg-[#805AD5] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.conversations} Conversations
              </div>
            </div>
            <div className="text-[#718096] text-sm">→</div>
            <div className="flex-1" style={{ flex: teamTotals.knocks > 0 ? teamTotals.appointments / teamTotals.knocks : 0 }}>
              <div className="bg-[#ED8936] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.appointments} Appointments
              </div>
            </div>
            <div className="text-[#718096] text-sm">→</div>
            <div className="flex-1" style={{ flex: teamTotals.knocks > 0 ? teamTotals.sales / teamTotals.knocks : 0 }}>
              <div className="bg-[#48BB78] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.sales} Sales
              </div>
            </div>
          </div>
        </div>

        {/* Leaderboards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#F6AD55]" />
              Top Performers - Knocks
            </h3>
            <div className="space-y-2">
              {setterMetrics.slice(0, 5).map((setter, index) => (
                <div key={setter.userId} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    index === 0 ? 'bg-[#F6AD55] text-white' : 'bg-[#E2E8F0] text-[#718096]'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-[#2D3748]">{setter.userName}</div>
                  </div>
                  <div className="text-lg font-bold text-[#2D3748]">{setter.knocks}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5 text-[#48BB78]" />
              Top Performers - Sales
            </h3>
            <div className="space-y-2">
              {[...setterMetrics].sort((a, b) => b.sales - a.sales).slice(0, 5).map((setter, index) => (
                <div key={setter.userId} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    index === 0 ? 'bg-[#48BB78] text-white' : 'bg-[#E2E8F0] text-[#718096]'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-[#2D3748]">{setter.userName}</div>
                  </div>
                  <div className="text-lg font-bold text-[#48BB78]">{setter.sales}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Setter Performance Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="p-6 border-b border-[#E2E8F0]">
            <h2 className="text-lg font-semibold text-[#2D3748] flex items-center gap-2">
              <Users className="w-5 h-5" />
              Individual Performance
            </h2>
          </div>
          
          {/* Sort Controls */}
          <div className="px-6 py-3 bg-[#F7FAFC] border-b border-[#E2E8F0]">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[#718096]">Sort by:</span>
              {(['knocks', 'conversations', 'appointments', 'sales'] as const).map((sort) => (
                <button
                  key={sort}
                  onClick={() => setSortBy(sort)}
                  className={`px-3 py-1 rounded ${
                    sortBy === sort
                      ? 'bg-[#FF5F5A] text-white'
                      : 'bg-white text-[#718096] hover:text-[#2D3748]'
                  }`}
                >
                  {sort.charAt(0).toUpperCase() + sort.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F7FAFC] text-xs font-semibold text-[#718096] uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Setter</th>
                  <th className="px-6 py-3 text-center">Knocks</th>
                  <th className="px-6 py-3 text-center">Conversations</th>
                  <th className="px-6 py-3 text-center">Conv Rate</th>
                  <th className="px-6 py-3 text-center">Appointments</th>
                  <th className="px-6 py-3 text-center">Appt Rate</th>
                  <th className="px-6 py-3 text-center">Sales</th>
                  <th className="px-6 py-3 text-center">Close Rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {setterMetrics.map((setter) => {
                  const convRate = parseFloat(calculateRate(setter.conversations, setter.knocks));
                  const apptRate = parseFloat(calculateRate(setter.appointments, setter.conversations));
                  const closeRate = parseFloat(calculateRate(setter.sales, setter.appointments));

                  return (
                    <tr key={setter.userId} className="hover:bg-[#F7FAFC] transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-[#2D3748]">{setter.userName}</div>
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-[#2D3748]">{setter.knocks}</td>
                      <td className="px-6 py-4 text-center font-semibold text-[#4299E1]">{setter.conversations}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getPerformanceColor(convRate, 'conversation')}`}>
                          {convRate}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-[#805AD5]">{setter.appointments}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getPerformanceColor(apptRate, 'appointment')}`}>
                          {apptRate}%
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center font-semibold text-[#48BB78]">{setter.sales}</td>
                      <td className="px-6 py-4 text-center">
                        <span className={`px-2 py-1 rounded text-xs font-semibold ${getPerformanceColor(closeRate, 'close')}`}>
                          {closeRate}%
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {setterMetrics.length === 0 && (
            <div className="p-12 text-center text-[#718096]">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No activity data for selected time period</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
