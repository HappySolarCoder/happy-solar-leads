'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Brain, TrendingUp, TrendingDown, AlertTriangle, CheckCircle, Clock, Target, MapPin, Zap } from 'lucide-react';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { User, Lead } from '@/app/types';
import { canSeeAllLeads } from '@/app/types';
import {
  calculateDailyMetrics,
  detectRedFlags,
  generateInsights,
  generateCoachingMessage,
  type AIAnalysis,
  type DailyMetrics,
  type RedFlag,
  type CoachingInsight,
} from '@/app/utils/aiManager';

export default function AIManagerPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [analyses, setAnalyses] = useState<AIAnalysis[]>([]);
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Load data
  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      
      if (!user) {
        router.push('/login');
        return;
      }

      // Only managers and admins can access
      if (!canSeeAllLeads(user.role)) {
        router.push('/');
        return;
      }

      setCurrentUser(user);
      
      const [loadedUsers, loadedLeads] = await Promise.all([
        getUsersAsync(),
        getLeadsAsync(),
      ]);

      setUsers(loadedUsers.filter(u => u.role === 'setter' || u.role === 'closer'));
      setLeads(loadedLeads);
      setLoading(false);
    }
    loadData();
  }, [router]);

  // Generate analyses
  const runAnalysis = async () => {
    setGenerating(true);
    const date = new Date(selectedDate);
    const newAnalyses: AIAnalysis[] = [];

    for (const user of users) {
      // Calculate days since user created
      const userCreatedDate = user.createdAt ? new Date(user.createdAt) : new Date();
      
      // Skip if invalid date
      if (isNaN(userCreatedDate.getTime())) continue;
      
      const daysSinceStart = Math.floor(
        (date.getTime() - userCreatedDate.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceStart < 0) continue; // Skip if date is before user created

      const metrics = calculateDailyMetrics(user.id, user.name, leads, date);
      
      // Skip if no activity
      if (metrics.doorsKnocked === 0) continue;

      const redFlags = detectRedFlags(metrics, daysSinceStart);
      const insights = generateInsights(metrics, redFlags, daysSinceStart);
      
      // Generate coaching message
      const coachingMessage = await generateCoachingMessage(metrics, redFlags, insights, daysSinceStart);

      newAnalyses.push({
        setterId: user.id,
        setterName: user.name,
        date: selectedDate,
        daysSinceStart,
        metrics,
        redFlags,
        insights,
        coachingMessage,
      });
    }

    setAnalyses(newAnalyses.sort((a, b) => b.metrics.doorsKnocked - a.metrics.doorsKnocked));
    setGenerating(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#FF5F5A] mx-auto mb-4"></div>
          <p className="text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      {/* Header */}
      <div className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-[#2D3748]">Virtual Manager AI</h1>
                <p className="text-sm text-[#718096]">Daily performance analysis & coaching</p>
              </div>
            </div>
            
            <button
              onClick={() => router.push('/')}
              className="px-4 py-2 text-[#718096] hover:text-[#2D3748] transition-colors"
            >
              ← Back to Map
            </button>
          </div>

          {/* Date Selector & Run Button */}
          <div className="mt-6 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-[#2D3748]">Analysis Date:</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                max={new Date().toISOString().split('T')[0]}
                className="px-3 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
            </div>
            
            <button
              onClick={runAnalysis}
              disabled={generating}
              className="px-6 py-2 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg hover:from-purple-600 hover:to-purple-700 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {generating ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                  Analyzing...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Run Analysis
                </>
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {analyses.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm p-12 text-center">
            <Brain className="w-16 h-16 text-[#CBD5E0] mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-[#2D3748] mb-2">No Analysis Yet</h2>
            <p className="text-[#718096] mb-6">
              Select a date and click "Run Analysis" to generate AI coaching insights
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Summary Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <StatCard
                icon={<Target className="w-5 h-5" />}
                label="Active Setters"
                value={analyses.length.toString()}
                color="blue"
              />
              <StatCard
                icon={<TrendingUp className="w-5 h-5" />}
                label="Total Doors"
                value={analyses.reduce((sum, a) => sum + a.metrics.doorsKnocked, 0).toString()}
                color="green"
              />
              <StatCard
                icon={<CheckCircle className="w-5 h-5" />}
                label="Total Appointments"
                value={analyses.reduce((sum, a) => sum + a.metrics.appointments, 0).toString()}
                color="purple"
              />
              <StatCard
                icon={<AlertTriangle className="w-5 h-5" />}
                label="Red Flags"
                value={analyses.reduce((sum, a) => sum + a.redFlags.filter(f => f.severity === 'critical').length, 0).toString()}
                color="red"
              />
            </div>

            {/* Setter Analyses */}
            {analyses.map((analysis) => (
              <SetterAnalysisCard key={analysis.setterId} analysis={analysis} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  const colors = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    red: 'bg-red-50 text-red-600',
  };

  return (
    <div className="bg-white rounded-xl shadow-sm p-4">
      <div className={`inline-flex p-2 rounded-lg ${colors[color as keyof typeof colors]} mb-2`}>
        {icon}
      </div>
      <div className="text-2xl font-bold text-[#2D3748]">{value}</div>
      <div className="text-sm text-[#718096]">{label}</div>
    </div>
  );
}

function SetterAnalysisCard({ analysis }: { analysis: AIAnalysis }) {
  const { metrics, redFlags, insights, coachingMessage, daysSinceStart } = analysis;

  return (
    <div className="bg-white rounded-2xl shadow-sm overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-500 to-purple-600 px-6 py-4">
        <div className="flex items-center justify-between text-white">
          <div>
            <h3 className="text-xl font-bold">{analysis.setterName}</h3>
            <p className="text-purple-100 text-sm">
              {daysSinceStart} days experience • {metrics.doorsKnocked} doors knocked
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold">{metrics.conversionRate.toFixed(1)}%</div>
            <div className="text-purple-100 text-sm">Conversion Rate</div>
          </div>
        </div>
      </div>

      {/* Coaching Message */}
      <div className="px-6 py-4 bg-purple-50 border-b border-purple-100">
        <div className="flex items-start gap-3">
          <Brain className="w-5 h-5 text-purple-600 mt-0.5 flex-shrink-0" />
          <p className="text-[#2D3748] leading-relaxed">{coachingMessage}</p>
        </div>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-6 border-b border-[#E2E8F0]">
        <MetricItem
          icon={<Target className="w-4 h-4" />}
          label="Appointments"
          value={metrics.appointments.toString()}
        />
        <MetricItem
          icon={<Clock className="w-4 h-4" />}
          label="Pace"
          value={`${metrics.pace.toFixed(1)} /hr`}
        />
        <MetricItem
          icon={<Zap className="w-4 h-4" />}
          label="Prime Time"
          value={`${metrics.primeTimePercentage.toFixed(0)}%`}
        />
        <MetricItem
          icon={<MapPin className="w-4 h-4" />}
          label="Territory"
          value={`${metrics.territorySize} addresses`}
        />
      </div>

      {/* Red Flags */}
      {redFlags.length > 0 && (
        <div className="px-6 py-4 border-b border-[#E2E8F0]">
          <h4 className="font-semibold text-[#2D3748] mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-500" />
            Red Flags
          </h4>
          <div className="space-y-2">
            {redFlags.map((flag, idx) => (
              <div
                key={idx}
                className={`flex items-start gap-2 p-3 rounded-lg ${
                  flag.severity === 'critical' ? 'bg-red-50 border border-red-200' : 'bg-yellow-50 border border-yellow-200'
                }`}
              >
                <AlertTriangle
                  className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                    flag.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'
                  }`}
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-[#2D3748]">{flag.message}</div>
                  <div className="text-xs text-[#718096] mt-1">
                    {flag.metric}: {flag.value.toFixed(1)} (threshold: {flag.threshold})
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Insights */}
      <div className="px-6 py-4">
        <h4 className="font-semibold text-[#2D3748] mb-3">Insights</h4>
        <div className="space-y-2">
          {insights.map((insight, idx) => (
            <div
              key={idx}
              className="flex items-start gap-2 text-sm"
            >
              {insight.category === 'positive' && <CheckCircle className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />}
              {insight.category === 'improvement' && <TrendingUp className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />}
              {insight.category === 'concern' && <TrendingDown className="w-4 h-4 text-orange-500 mt-0.5 flex-shrink-0" />}
              <div>
                <div className="text-[#2D3748]">{insight.message}</div>
                {insight.suggestedAction && (
                  <div className="text-[#718096] text-xs mt-1">→ {insight.suggestedAction}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricItem({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div>
      <div className="flex items-center gap-2 text-[#718096] text-sm mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="text-lg font-bold text-[#2D3748]">{value}</div>
    </div>
  );
}
