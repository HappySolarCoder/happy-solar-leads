'use client';

import { useState, useEffect } from 'react';
import { AlertCircle, TrendingUp, Users, MapPin, ArrowLeft, BarChart3 } from 'lucide-react';
import Link from 'next/link';
import { Lead, ObjectionType, OBJECTION_LABELS, OBJECTION_COLORS, User } from '@/app/types';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';

export default function ObjectionsAnalytics() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedSetter, setSelectedSetter] = useState<string>('all');

  useEffect(() => {
    async function loadData() {
      const loadedLeads = await getLeadsAsync();
      setLeads(loadedLeads);
      const loadedUsers = await getUsersAsync();
      setUsers(loadedUsers);
    }
    loadData();
  }, []);

  // Filter leads with objections
  const leadsWithObjections = leads.filter(l => l.objectionType);
  
  // Filter by setter if selected
  const filteredLeads = selectedSetter === 'all' 
    ? leadsWithObjections 
    : leadsWithObjections.filter(l => l.objectionRecordedBy === selectedSetter);

  // Calculate objection frequency
  const objectionCounts: Record<string, number> = {};
  filteredLeads.forEach(lead => {
    if (lead.objectionType) {
      objectionCounts[lead.objectionType] = (objectionCounts[lead.objectionType] || 0) + 1;
    }
  });

  const objectionStats = Object.entries(objectionCounts)
    .map(([type, count]) => ({
      type: type as ObjectionType,
      count,
      percentage: (count / filteredLeads.length) * 100,
    }))
    .sort((a, b) => b.count - a.count);

  // Per-setter stats
  const setterStats = users.map(user => {
    const setterLeads = leadsWithObjections.filter(l => l.objectionRecordedBy === user.id);
    const setterCounts: Record<string, number> = {};
    setterLeads.forEach(lead => {
      if (lead.objectionType) {
        setterCounts[lead.objectionType] = (setterCounts[lead.objectionType] || 0) + 1;
      }
    });
    const topObjection = Object.entries(setterCounts)
      .sort((a, b) => b[1] - a[1])[0];
    
    return {
      user,
      totalObjections: setterLeads.length,
      topObjection: topObjection ? topObjection[0] as ObjectionType : null,
      topObjectionCount: topObjection ? topObjection[1] : 0,
    };
  }).filter(s => s.totalObjections > 0)
    .sort((a, b) => b.totalObjections - a.totalObjections);

  return (
    <div className="min-h-screen bg-gradient-to-br from-red-50 to-pink-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-red-600 hover:text-red-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Leads
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Objection Analytics
          </h1>
          <p className="text-gray-600">
            Understand why prospects say no and improve your pitch
          </p>
        </div>

        {/* Filter */}
        <div className="mb-6 flex items-center gap-4">
          <label className="text-sm font-medium text-gray-700">Filter by Setter:</label>
          <select
            value={selectedSetter}
            onChange={(e) => setSelectedSetter(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-transparent"
          >
            <option value="all">All Setters</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
          </select>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <AlertCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Total Objections</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{filteredLeads.length}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <BarChart3 className="w-4 h-4" />
              <span className="text-sm font-medium">Unique Types</span>
            </div>
            <div className="text-2xl font-bold text-red-600">{objectionStats.length}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Top Objection</span>
            </div>
            <div className="text-sm font-bold text-red-600">
              {objectionStats[0] ? OBJECTION_LABELS[objectionStats[0].type] : 'N/A'}
            </div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">Setters Tracking</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{setterStats.length}</div>
          </div>
        </div>

        {/* Objection Breakdown */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Objection Breakdown</h2>
          <div className="space-y-4">
            {objectionStats.map((stat) => (
              <div key={stat.type} className="relative">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-3">
                    <div 
                      className="w-4 h-4 rounded-full"
                      style={{ backgroundColor: OBJECTION_COLORS[stat.type] }}
                    />
                    <span className="font-medium text-gray-900">
                      {OBJECTION_LABELS[stat.type]}
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-600">
                      {stat.count} ({stat.percentage.toFixed(1)}%)
                    </span>
                  </div>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-3">
                  <div
                    className="h-3 rounded-full transition-all duration-500"
                    style={{
                      width: `${stat.percentage}%`,
                      backgroundColor: OBJECTION_COLORS[stat.type],
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Per-Setter Analysis */}
        <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-6 mb-6">
          <h2 className="text-xl font-bold text-gray-900 mb-4">By Setter</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {setterStats.map((stat) => (
              <div key={stat.user.id} className="border border-gray-200 rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div 
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: stat.user.color }}
                  />
                  <h3 className="font-semibold text-gray-900">{stat.user.name}</h3>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Total Objections:</span>
                    <span className="font-semibold text-gray-900">{stat.totalObjections}</span>
                  </div>
                  {stat.topObjection && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Most Common:</p>
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{ backgroundColor: OBJECTION_COLORS[stat.topObjection] }}
                        />
                        <span className="text-xs font-medium text-gray-700">
                          {OBJECTION_LABELS[stat.topObjection]}
                        </span>
                        <span className="text-xs text-gray-500">
                          ({stat.topObjectionCount}x)
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coaching Insights */}
        <div className="bg-gradient-to-br from-blue-50 to-indigo-100 rounded-xl p-6 border border-blue-200">
          <h2 className="text-xl font-bold text-gray-900 mb-4">💡 Coaching Insights</h2>
          <div className="space-y-4">
            {objectionStats.slice(0, 3).map((stat, index) => (
              <div key={stat.type} className="bg-white rounded-lg p-4 border border-blue-200">
                <div className="flex items-start gap-3">
                  <div className="w-6 h-6 bg-blue-500 text-white rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <h3 className="font-semibold text-gray-900 mb-1">
                      {OBJECTION_LABELS[stat.type]}
                    </h3>
                    <p className="text-sm text-gray-600 mb-2">
                      {getCoachingTip(stat.type)}
                    </p>
                    <div className="text-xs text-gray-500">
                      Appears in {stat.percentage.toFixed(0)}% of objections
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function getCoachingTip(objection: ObjectionType): string {
  const tips: Record<ObjectionType, string> = {
    'too-expensive': 'Focus on monthly savings vs. upfront cost. Show ROI calculator and financing options. Emphasize long-term value.',
    'bad-credit': 'Highlight credit-flexible financing options. Focus on immediate savings. Consider cash deals or lease options.',
    'roof-issues': 'Offer free roof inspection. Partner with roofing company for bundled deal. Show examples of roof + solar combos.',
    'moving-soon': 'Emphasize increased home value. Show transfer/buyout options. Discuss portable systems if applicable.',
    'not-owner': 'Ask if owner is available. Offer landlord-specific benefits. Get referral to decision maker.',
    'already-has-solar': 'Ask about age/performance of current system. Discuss expansion or upgrade options. Move on quickly.',
    'too-complicated': 'Simplify the pitch. Use visual aids and simple analogies. Focus on benefits, not technical details.',
    'need-to-think': 'Set specific follow-up date. Leave calculation sheet. Address hidden concerns - ask questions.',
    'not-interested-in-solar': 'Qualify early to save time. Ask why (bill too low? environmental concerns?). Thank and move on.',
    'other': 'Document specific details. Look for patterns in custom objections. Share with team for script improvements.',
  };
  return tips[objection] || 'No specific tip available.';
}
