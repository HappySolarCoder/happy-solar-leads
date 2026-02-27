'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { TrendingUp, Target, DollarSign, Award, ArrowLeft, Users, Calendar, Trophy, BarChart3 } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getDispositionsAsync } from '@/app/utils/dispositions';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User } from '@/app/types';
import { Disposition } from '@/app/types/disposition';
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
  goBacksScheduled: number; // Go-backs scheduled by this setter
  goBacksConverted: number; // Go-backs that converted to appointments
}

type TimeFilter = 'today' | 'yesterday' | 'last7days' | 'thisweek' | 'lastweek' | 'thismonth' | 'lastmonth' | 'all';

interface SetterMetrics {
  userId: string;
  userName: string;
  knocks: number; // dispositioned leads (countsAsDoorKnock)
  conversations: number; // interested + appointment + sale
  appointments: number; // appointment disposition
  sales: number; // sale disposition
  notHome: number;
  notInterested: number;
  goBacksScheduled: number; // Go-backs scheduled by this setter
  goBacksConverted: number; // Go-backs that converted to appointments
}

type SortBy = 'knocks' | 'conversations' | 'appointments' | 'goBacks';

export default function DataDashboard() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [dispositions, setDispositions] = useState<Disposition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('today');
  const [sortBy, setSortBy] = useState<SortBy>('knocks');

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
      const loadedDispositions = await getDispositionsAsync();

      setLeads(loadedLeads);
      setUsers(loadedUsers);
      setDispositions(loadedDispositions);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  // Calculate metrics for each setter
  const calculateSetterMetrics = (): SetterMetrics[] => {
    const setterMap = new Map<string, SetterMetrics>();

    // Get time filter cutoff
    let cutoffDate: Date;
    let endDate: Date | undefined;

    switch (timeFilter) {
      case 'today':
        cutoffDate = startOfToday();
        endDate = undefined;
        break;
      case 'yesterday':
        // Yesterday: from start of yesterday to start of today
        cutoffDate = new Date(startOfToday().getTime() - 86400000); // Start of yesterday
        endDate = startOfToday(); // Start of today (exclusive)
        break;
      case 'last7days':
        cutoffDate = new Date(Date.now() - 7 * 86400000);
        break;
      case 'thisweek':
        cutoffDate = startOfWeek(new Date());
        break;
      case 'lastweek':
        cutoffDate = new Date(startOfWeek(new Date()).getTime() - 7 * 86400000);
        break;
      case 'thismonth':
        cutoffDate = startOfMonth(new Date());
        break;
      case 'lastmonth':
        cutoffDate = new Date(startOfMonth(new Date()).getTime() - 30 * 86400000);
        break;
      default:
        cutoffDate = new Date(0); // All time
        endDate = undefined;
    }

    // Get door knock statuses from dispositions
    const doorKnockStatusIds = dispositions
      .filter(d => d.countsAsDoorKnock)
      .map(d => d.id.toLowerCase());

    // Filter leads by time
    const filteredLeads = leads.filter(lead => {
      if (!lead.dispositionedAt) return false;
      const leadDate = new Date(lead.dispositionedAt);
      // Must be after cutoff date
      if (!isAfter(leadDate, cutoffDate)) return false;
      // If endDate is set, must be before end date (for yesterday filter)
      if (endDate && !isAfter(endDate, leadDate)) return false;
      return true;
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
          goBacksScheduled: 0,
          goBacksConverted: 0,
        });
      }

      const metrics = setterMap.get(userId)!;
      const leadStatus = lead.status?.toLowerCase() || '';

      // Count knocks (disposition where countsAsDoorKnock === true)
      if (doorKnockStatusIds.includes(leadStatus)) {
        metrics.knocks++;
      }

      // Count specific dispositions
      switch (lead.status) {
        case 'not-home':
          metrics.notHome++;
          break;
        case 'not-interested':
          metrics.notInterested++;
          metrics.conversations++; // Had a conversation, just said no
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

      // Track go-backs: leads that were scheduled for go-back by this setter
      if (lead.goBackScheduledBy === userId) {
        metrics.goBacksScheduled++;
        // If this go-back converted to appointment or sale, count it
        if (lead.status === 'appointment' || lead.status === 'sale') {
          metrics.goBacksConverted++;
        }
      }
    });

    // Convert to array and sort
    const metricsArray = Array.from(setterMap.values());
    
    // Sort by selected metric
    if (sortBy === 'goBacks') {
      metricsArray.sort((a, b) => b.goBacksScheduled - a.goBacksScheduled);
    } else {
      metricsArray.sort((a, b) => b[sortBy] - a[sortBy]);
    }

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
      goBacksScheduled: acc.goBacksScheduled + setter.goBacksScheduled,
      goBacksConverted: acc.goBacksConverted + setter.goBacksConverted,
    }),
    { knocks: 0, conversations: 0, appointments: 0, sales: 0, notHome: 0, notInterested: 0, goBacksScheduled: 0, goBacksConverted: 0 }
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
    <div className="min-h-screen bg-[#F7FAFC] p-2 sm:p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-4 sm:mb-6">
          {/* Logo & Back - Top Row */}
          <div className="flex items-center justify-between mb-3 sm:mb-4">
            <button
              onClick={() => router.push('/tools')}
              className="inline-flex items-center gap-2 text-[#4299E1] hover:text-[#3182CE] text-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="hidden sm:inline">Back</span>
            </button>
            <img 
              src="/raydar-icon.png" 
              alt="Raydar" 
              className="h-8 w-8 sm:h-10 sm:w-10 object-contain"
            />
            <div className="w-16 sm:w-20"></div>
          </div>
          
          {/* Centered Title & Filters */}
          <div className="text-center">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-[#2D3748] mb-1 sm:mb-2">Team Performance</h1>
            <p className="text-xs sm:text-sm text-[#718096] mb-3 sm:mb-4">Real-time setter metrics</p>
            
            {/* Time Filter */}
            <div className="flex flex-wrap justify-center gap-1 sm:gap-2 bg-white p-2 rounded-lg shadow-sm">
              {([
                { key: 'today', label: 'Today' },
                { key: 'yesterday', label: 'Yesterday' },
                { key: 'last7days', label: '7 Days' },
                { key: 'thisweek', label: 'This Wk' },
                { key: 'lastweek', label: 'Last Wk' },
                { key: 'thismonth', label: 'This Mo' },
                { key: 'lastmonth', label: 'Last Mo' },
                { key: 'all', label: 'All' },
              ] as { key: TimeFilter; label: string }[]).map((f) => (
                <button
                  key={f.key}
                  onClick={() => setTimeFilter(f.key)}
                  className={`px-2 sm:px-3 py-1.5 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                    timeFilter === f.key
                      ? 'bg-[#FF5F5A] text-white'
                      : 'text-[#718096] hover:text-[#2D3748] bg-gray-100'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Team Overview Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Target className="w-4 h-4" />
              <span className="text-sm font-medium">Total Knocks</span>
            </div>
            <div className="text-3xl font-bold text-[#2D3748]">{teamTotals.knocks}</div>
            <div className="text-xs text-[#718096] mt-1 truncate">
              {teamTotals.notHome} NH, {teamTotals.notInterested} NI
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Convos</span>
            </div>
            <div className="text-3xl font-bold text-[#4299E1]">{teamTotals.conversations}</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.conversations, teamTotals.knocks)}% Rate
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Award className="w-4 h-4" />
              <span className="text-sm font-medium">Appts</span>
            </div>
            <div className="text-3xl font-bold text-[#805AD5]">{teamTotals.appointments}</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.appointments, teamTotals.conversations)}% of Convos
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm font-medium">Appt % Knocks</span>
            </div>
            <div className="text-3xl font-bold text-[#DD6B20]">{calculateRate(teamTotals.appointments, teamTotals.knocks)}%</div>
            <div className="text-xs text-[#718096] mt-1">
              {calculateRate(teamTotals.appointments, teamTotals.knocks)}% of Knocks
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm border-2 border-[#F6E05E]">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Calendar className="w-4 h-4 text-[#D69E2E]" />
              <span className="text-sm font-medium">Go-Backs</span>
            </div>
            <div className="text-3xl font-bold text-[#D69E2E]">{teamTotals.goBacksScheduled}</div>
            <div className="text-xs text-[#718096] mt-1">
              {teamTotals.goBacksConverted} converted ({calculateRate(teamTotals.goBacksConverted, teamTotals.goBacksScheduled)}%)
            </div>
          </div>
        </div>

        {/* Funnel Visualization */}
        <div className="bg-white rounded-lg p-4 lg:p-6 shadow-sm mb-6">
          <h2 className="text-base lg:text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 lg:w-5 h-4 lg:h-5" />
            Conversion Funnel
          </h2>
          <div className="hidden lg:flex items-center gap-2">
            <div className="flex-1">
              <div className="bg-[#4299E1] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.knocks} Knocks
              </div>
            </div>
            <div className="text-[#718096] text-sm">→</div>
            <div className="flex-1" style={{ flex: teamTotals.knocks > 0 ? teamTotals.conversations / teamTotals.knocks : 0 }}>
              <div className="bg-[#805AD5] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.conversations} Convos
              </div>
            </div>
            <div className="text-[#718096] text-sm">→</div>
            <div className="flex-1" style={{ flex: teamTotals.knocks > 0 ? teamTotals.appointments / teamTotals.knocks : 0 }}>
              <div className="bg-[#48BB78] h-12 rounded flex items-center justify-center text-white font-semibold">
                {teamTotals.appointments} Appts
              </div>
            </div>
          </div>
          {/* Mobile Funnel (vertical) */}
          <div className="lg:hidden space-y-2">
            <div className="bg-[#4299E1] p-3 rounded text-white font-semibold text-center">
              {teamTotals.knocks} Knocks
            </div>
            <div className="text-center text-[#718096]">↓</div>
            <div className="bg-[#805AD5] p-3 rounded text-white font-semibold text-center">
              {teamTotals.conversations} Conversations
            </div>
            <div className="text-center text-[#718096]">↓</div>
            <div className="bg-[#48BB78] p-3 rounded text-white font-semibold text-center">
              {teamTotals.appointments} Appointments
            </div>
          </div>
        </div>

        {/* Leaderboards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg p-4 lg:p-6 shadow-sm">
            <h3 className="text-base lg:text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <Trophy className="w-4 lg:w-5 h-4 lg:h-5 text-[#F6AD55]" />
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
                    <div className="font-medium text-[#2D3748] text-sm lg:text-base">{setter.userName}</div>
                  </div>
                  <div className="text-base lg:text-lg font-bold text-[#2D3748]">{setter.knocks}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 lg:p-6 shadow-sm">
            <h3 className="text-base lg:text-lg font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <Trophy className="w-4 lg:w-5 h-4 lg:h-5 text-[#805AD5]" />
              Top Performers - Appointments
            </h3>
            <div className="space-y-2">
              {[...setterMetrics].sort((a, b) => b.appointments - a.appointments).slice(0, 5).map((setter, index) => (
                <div key={setter.userId} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    index === 0 ? 'bg-[#805AD5] text-white' : 'bg-[#E2E8F0] text-[#718096]'
                  }`}>
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-[#2D3748] text-sm lg:text-base">{setter.userName}</div>
                  </div>
                  <div className="text-base lg:text-lg font-bold text-[#805AD5]">{setter.appointments}</div>
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
          <div className="px-4 lg:px-6 py-3 bg-[#F7FAFC] border-b border-[#E2E8F0] overflow-x-auto">
            <div className="flex items-center gap-2 text-xs lg:text-sm min-w-max">
              <span className="text-[#718096] hidden sm:inline">Sort by:</span>
              {(['knocks', 'conversations', 'appointments', 'goBacks'] as const).map((sort) => (
                <button
                  key={sort}
                  onClick={() => setSortBy(sort)}
                  className={`px-2 lg:px-3 py-1.5 rounded whitespace-nowrap ${
                    sortBy === sort
                      ? 'bg-[#FF5F5A] text-white'
                      : 'bg-white text-[#718096] hover:text-[#2D3748]'
                  }`}
                >
                  {sort === 'knocks' ? 'Knocks' : sort === 'conversations' ? 'Convos' : sort === 'appointments' ? 'Appts' : 'Go-Backs'}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
            <table className="w-full min-w-[500px] sm:min-w-[640px]">
              <thead className="bg-[#F7FAFC] text-xs font-semibold text-[#718096] uppercase">
                <tr>
                  <th className="px-2 py-3 text-left">Setter</th>
                  <th className="px-1 py-3 text-center">Knocks</th>
                  <th className="px-1 py-3 text-center">Convos</th>
                  <th className="px-1 py-3 text-center hidden md:table-cell">Conv%</th>
                  <th className="px-1 py-3 text-center">Appts</th>
                  <th className="px-1 py-3 text-center hidden md:table-cell">Appt%</th>
                  <th className="px-1 py-3 text-center hidden lg:table-cell">GB</th>
                  <th className="px-1 py-3 text-center hidden lg:table-cell">GB%</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E2E8F0]">
                {setterMetrics.map((setter) => {
                  const convRate = parseFloat(calculateRate(setter.conversations, setter.knocks));
                  const apptRateConvos = parseFloat(calculateRate(setter.appointments, setter.conversations));
                  const gbConvRate = parseFloat(calculateRate(setter.goBacksConverted, setter.goBacksScheduled));

                  return (
                    <tr key={setter.userId} className="hover:bg-[#F7FAFC] transition-colors">
                      <td className="px-2 py-3">
                        <div className="font-medium text-[#2D3748] text-sm truncate max-w-[100px] sm:max-w-[150px]">{setter.userName}</div>
                      </td>
                      <td className="px-1 py-3 text-center font-semibold text-[#2D3748] text-sm">{setter.knocks}</td>
                      <td className="px-1 py-3 text-center font-semibold text-[#4299E1] text-sm">{setter.conversations}</td>
                      <td className="px-1 py-3 text-center hidden md:table-cell">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getPerformanceColor(convRate, 'conversation')}`}>
                          {convRate}%
                        </span>
                      </td>
                      <td className="px-1 py-3 text-center font-semibold text-[#805AD5] text-sm">{setter.appointments}</td>
                      <td className="px-1 py-3 text-center hidden md:table-cell">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getPerformanceColor(apptRateConvos, 'appointment')}`}>
                          {apptRateConvos}%
                        </span>
                      </td>
                      <td className="px-1 py-3 text-center hidden lg:table-cell font-semibold text-[#D69E2E] text-sm">{setter.goBacksScheduled}</td>
                      <td className="px-1 py-3 text-center hidden lg:table-cell">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${getPerformanceColor(gbConvRate, 'appointment')}`}>
                          {gbConvRate}%
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
