'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, TrendingUp, Target, Award, Trophy, Calendar, Zap, BarChart2 } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User } from '@/app/types';
import { startOfToday, startOfWeek, startOfMonth, subDays, isAfter, format, isSameDay } from 'date-fns';

interface DayMetrics {
  date: Date;
  knocks: number;
  conversations: number;
  appointments: number;
  sales: number;
}

export default function MobileStatsPage() {
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

      const loadedLeads = await getLeadsAsync();
      const loadedUsers = await getUsersAsync();

      setLeads(loadedLeads);
      setUsers(loadedUsers);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  // Filter user's leads
  const myLeads = leads.filter(lead => lead.claimedBy === currentUser?.id);

  // Calculate metrics for time period
  const calculateMetrics = (cutoffDate: Date) => {
    const filteredLeads = myLeads.filter(lead => {
      if (!lead.dispositionedAt) return false;
      return isAfter(new Date(lead.dispositionedAt), cutoffDate);
    });

    let knocks = 0, conversations = 0, appointments = 0, sales = 0;

    filteredLeads.forEach(lead => {
      if (lead.status && ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(lead.status)) {
        knocks++;
      }

      switch (lead.status) {
        case 'interested':
          conversations++;
          break;
        case 'appointment':
          appointments++;
          conversations++;
          break;
        case 'sale':
          sales++;
          appointments++;
          conversations++;
          break;
      }
    });

    return { knocks, conversations, appointments, sales };
  };

  // Get metrics by time period
  const today = calculateMetrics(startOfToday());
  const week = calculateMetrics(startOfWeek(new Date()));
  const month = calculateMetrics(startOfMonth(new Date()));

  // Calculate 7-day trend
  const last7Days: DayMetrics[] = [];
  for (let i = 6; i >= 0; i--) {
    const date = subDays(new Date(), i);
    const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayLeads = myLeads.filter(lead => {
      if (!lead.dispositionedAt) return false;
      return isSameDay(new Date(lead.dispositionedAt), date);
    });

    let knocks = 0, conversations = 0, appointments = 0, sales = 0;
    dayLeads.forEach(lead => {
      if (lead.status && ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(lead.status)) {
        knocks++;
      }
      if (['interested', 'appointment', 'sale'].includes(lead.status!)) conversations++;
      if (['appointment', 'sale'].includes(lead.status!)) appointments++;
      if (lead.status === 'sale') sales++;
    });

    last7Days.push({ date, knocks, conversations, appointments, sales });
  }

  // Team average (for comparison)
  const teamTotals = users.reduce((acc, user) => {
    const userLeads = leads.filter(l => l.claimedBy === user.id && l.dispositionedAt && isAfter(new Date(l.dispositionedAt), startOfWeek(new Date())));
    let knocks = 0;
    userLeads.forEach(l => {
      if (l.status && ['not-home', 'interested', 'not-interested', 'appointment', 'sale'].includes(l.status)) knocks++;
    });
    return acc + knocks;
  }, 0);
  const teamAvg = users.length > 0 ? Math.round(teamTotals / users.length) : 0;

  // Achievement badges
  const badges = [
    { id: '100doors', name: '100 Doors', icon: '🚪', unlocked: month.knocks >= 100, progress: Math.min(month.knocks, 100) },
    { id: '50convos', name: '50 Conversations', icon: '💬', unlocked: month.conversations >= 50, progress: Math.min(month.conversations, 50) },
    { id: '10appts', name: '10 Appointments', icon: '📅', unlocked: month.appointments >= 10, progress: Math.min(month.appointments, 10) },
    { id: '5sales', name: '5 Sales', icon: '🎉', unlocked: month.sales >= 5, progress: Math.min(month.sales, 5) },
  ];

  // Max for chart scaling
  const maxKnocks = Math.max(...last7Days.map(d => d.knocks), 1);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading your stats...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC] pb-6">
      {/* Sticky Header with Quick Stats */}
      <div className="sticky top-0 z-10 bg-white shadow-sm">
        <div className="px-4 py-3 border-b border-[#E2E8F0]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/mobile')}
              className="p-2 -ml-2 text-[#718096] hover:text-[#FF5F5A] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-[#2D3748]">My Performance</h1>
          </div>
        </div>
        
        {/* Quick Metrics Bar */}
        <div className="px-4 py-3 bg-gradient-to-r from-[#FF5F5A] to-[#F27141] text-white">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs opacity-90">Today's Knocks</div>
              <div className="text-3xl font-bold">{today.knocks}</div>
            </div>
            <div className="text-right">
              <div className="flex items-center gap-4 text-sm">
                <div>
                  <div className="opacity-90">Convos</div>
                  <div className="text-xl font-semibold">{today.conversations}</div>
                </div>
                <div>
                  <div className="opacity-90">Appts</div>
                  <div className="text-xl font-semibold">{today.appointments}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="px-4 py-6 space-y-6">
        {/* Period Stats Cards */}
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-xs font-medium">This Week</span>
            </div>
            <div className="text-2xl font-bold text-[#2D3748]">{week.knocks}</div>
            <div className="text-xs text-[#718096] mt-1">
              {week.conversations} conversations
            </div>
          </div>

          <div className="bg-white rounded-lg p-4 shadow-sm">
            <div className="flex items-center gap-2 text-[#718096] mb-1">
              <Calendar className="w-4 h-4" />
              <span className="text-xs font-medium">This Month</span>
            </div>
            <div className="text-2xl font-bold text-[#2D3748]">{month.knocks}</div>
            <div className="text-xs text-[#718096] mt-1">
              {month.appointments} appointments
            </div>
          </div>
        </div>

        {/* 7-Day Trend Chart */}
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
            <TrendingUp className="w-4 h-4" />
            Last 7 Days
          </h2>
          <div className="flex items-end justify-between gap-1 h-32">
            {last7Days.map((day, index) => {
              const height = maxKnocks > 0 ? (day.knocks / maxKnocks) * 100 : 0;
              const isToday = index === 6;
              return (
                <div key={index} className="flex-1 flex flex-col items-center gap-1">
                  <div className="flex-1 flex items-end w-full">
                    <div
                      className={`w-full rounded-t transition-all ${
                        isToday ? 'bg-[#FF5F5A]' : 'bg-[#4299E1]'
                      }`}
                      style={{ height: `${height}%` }}
                    />
                  </div>
                  <div className="text-xs text-[#718096] font-medium">
                    {format(day.date, 'EEE')[0]}
                  </div>
                  <div className="text-xs font-bold text-[#2D3748]">
                    {day.knocks}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Team Comparison */}
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[#2D3748] mb-3 flex items-center gap-2">
            <BarChart2 className="w-4 h-4" />
            vs Team Average (This Week)
          </h2>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="text-xs text-[#718096] mb-1">You</div>
              <div className="text-2xl font-bold text-[#FF5F5A]">{week.knocks}</div>
            </div>
            <div className="text-2xl text-[#CBD5E0]">vs</div>
            <div className="flex-1 text-right">
              <div className="text-xs text-[#718096] mb-1">Team Avg</div>
              <div className="text-2xl font-bold text-[#4299E1]">{teamAvg}</div>
            </div>
          </div>
          {week.knocks > teamAvg && (
            <div className="mt-3 px-3 py-2 bg-green-50 rounded text-sm text-green-700 font-medium text-center">
              🔥 You're {week.knocks - teamAvg} ahead of average!
            </div>
          )}
          {week.knocks < teamAvg && teamAvg > 0 && (
            <div className="mt-3 px-3 py-2 bg-yellow-50 rounded text-sm text-yellow-700 font-medium text-center">
              💪 {teamAvg - week.knocks} behind average - keep pushing!
            </div>
          )}
        </div>

        {/* Achievement Badges */}
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[#2D3748] mb-3 flex items-center gap-2">
            <Trophy className="w-4 h-4 text-[#F6AD55]" />
            Achievements (This Month)
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {badges.map((badge) => (
              <div
                key={badge.id}
                className={`p-3 rounded-lg border-2 transition-all ${
                  badge.unlocked
                    ? 'border-[#F6AD55] bg-[#FEFCF8]'
                    : 'border-[#E2E8F0] bg-[#F7FAFC]'
                }`}
              >
                <div className="text-2xl mb-1 text-center">{badge.icon}</div>
                <div className={`text-xs font-semibold text-center mb-2 ${
                  badge.unlocked ? 'text-[#F6AD55]' : 'text-[#718096]'
                }`}>
                  {badge.name}
                </div>
                {!badge.unlocked && (
                  <div className="w-full bg-[#E2E8F0] rounded-full h-1.5">
                    <div
                      className="bg-[#4299E1] h-1.5 rounded-full transition-all"
                      style={{ width: `${(badge.progress / (badge.id === '100doors' ? 100 : badge.id === '50convos' ? 50 : badge.id === '10appts' ? 10 : 5)) * 100}%` }}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Performance Rates */}
        <div className="bg-white rounded-lg p-4 shadow-sm">
          <h2 className="text-sm font-semibold text-[#2D3748] mb-3 flex items-center gap-2">
            <Award className="w-4 h-4" />
            Conversion Rates (This Week)
          </h2>
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#718096]">Conversation Rate</span>
                <span className="text-sm font-bold text-[#2D3748]">
                  {week.knocks > 0 ? ((week.conversations / week.knocks) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-2">
                <div
                  className="bg-[#4299E1] h-2 rounded-full transition-all"
                  style={{ width: `${week.knocks > 0 ? Math.min((week.conversations / week.knocks) * 100, 100) : 0}%` }}
                />
              </div>
            </div>
            
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#718096]">Appointment Rate</span>
                <span className="text-sm font-bold text-[#2D3748]">
                  {week.conversations > 0 ? ((week.appointments / week.conversations) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-2">
                <div
                  className="bg-[#805AD5] h-2 rounded-full transition-all"
                  style={{ width: `${week.conversations > 0 ? Math.min((week.appointments / week.conversations) * 100, 100) : 0}%` }}
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[#718096]">Close Rate</span>
                <span className="text-sm font-bold text-[#2D3748]">
                  {week.appointments > 0 ? ((week.sales / week.appointments) * 100).toFixed(1) : '0.0'}%
                </span>
              </div>
              <div className="w-full bg-[#E2E8F0] rounded-full h-2">
                <div
                  className="bg-[#48BB78] h-2 rounded-full transition-all"
                  style={{ width: `${week.appointments > 0 ? Math.min((week.sales / week.appointments) * 100, 100) : 0}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Personal Bests */}
        <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 shadow-sm border border-purple-200">
          <h2 className="text-sm font-semibold text-purple-700 mb-3 flex items-center gap-2">
            <Zap className="w-4 h-4" />
            Personal Bests (All Time)
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white/60 rounded p-2 text-center">
              <div className="text-2xl font-bold text-purple-600">
                {Math.max(...last7Days.map(d => d.knocks), month.knocks)}
              </div>
              <div className="text-xs text-purple-700">Best Day</div>
            </div>
            <div className="bg-white/60 rounded p-2 text-center">
              <div className="text-2xl font-bold text-purple-600">{month.knocks}</div>
              <div className="text-xs text-purple-700">Best Month</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
