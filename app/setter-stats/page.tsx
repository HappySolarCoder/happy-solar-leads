'use client';

import { useState } from 'react';
import { TrendingUp, Target, DollarSign, Award, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

interface SetterStats {
  name: string;
  knocks: number;
  conversations: number;
  appointments: number;
  sales: number;
  avgDealSize: number;
}

export default function SetterStatsCalculator() {
  const [setters, setSetters] = useState<SetterStats[]>([
    { name: 'Setter 1', knocks: 0, conversations: 0, appointments: 0, sales: 0, avgDealSize: 25000 }
  ]);

  const addSetter = () => {
    setSetters([...setters, {
      name: `Setter ${setters.length + 1}`,
      knocks: 0,
      conversations: 0,
      appointments: 0,
      sales: 0,
      avgDealSize: 25000
    }]);
  };

  const updateSetter = (index: number, field: keyof SetterStats, value: string | number) => {
    const updated = [...setters];
    updated[index] = { ...updated[index], [field]: value };
    setSetters(updated);
  };

  const removeSetter = (index: number) => {
    if (setters.length > 1) {
      setSetters(setters.filter((_, i) => i !== index));
    }
  };

  const calculateMetrics = (setter: SetterStats) => {
    const conversationRate = setter.knocks > 0 ? (setter.conversations / setter.knocks) * 100 : 0;
    const appointmentRate = setter.conversations > 0 ? (setter.appointments / setter.conversations) * 100 : 0;
    const closeRate = setter.appointments > 0 ? (setter.sales / setter.appointments) * 100 : 0;
    const overallConversion = setter.knocks > 0 ? (setter.sales / setter.knocks) * 100 : 0;
    const revenue = setter.sales * setter.avgDealSize;
    const revenuePerKnock = setter.knocks > 0 ? revenue / setter.knocks : 0;
    
    return {
      conversationRate,
      appointmentRate,
      closeRate,
      overallConversion,
      revenue,
      revenuePerKnock
    };
  };

  const getPerformanceLevel = (rate: number, type: 'conversation' | 'appointment' | 'close') => {
    const thresholds = {
      conversation: { excellent: 40, good: 25, average: 15 },
      appointment: { excellent: 50, good: 35, average: 20 },
      close: { excellent: 30, good: 20, average: 10 }
    };
    
    const t = thresholds[type];
    if (rate >= t.excellent) return { label: 'Excellent', color: 'text-green-600 bg-green-50' };
    if (rate >= t.good) return { label: 'Good', color: 'text-blue-600 bg-blue-50' };
    if (rate >= t.average) return { label: 'Average', color: 'text-yellow-600 bg-yellow-50' };
    return { label: 'Needs Work', color: 'text-red-600 bg-red-50' };
  };

  const teamTotals = setters.reduce((acc, setter) => ({
    knocks: acc.knocks + setter.knocks,
    conversations: acc.conversations + setter.conversations,
    appointments: acc.appointments + setter.appointments,
    sales: acc.sales + setter.sales,
    revenue: acc.revenue + (setter.sales * setter.avgDealSize)
  }), { knocks: 0, conversations: 0, appointments: 0, sales: 0, revenue: 0 });

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <Link 
            href="/" 
            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-700 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Leads
          </Link>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">
            Setter Performance Calculator
          </h1>
          <p className="text-gray-600">
            Track, analyze, and optimize your door-knocking team's performance
          </p>
        </div>

        {/* Team Overview */}
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <Target className="w-4 h-4" />
              <span className="text-sm font-medium">Total Knocks</span>
            </div>
            <div className="text-2xl font-bold text-gray-900">{teamTotals.knocks}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-sm font-medium">Conversations</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">{teamTotals.conversations}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <Award className="w-4 h-4" />
              <span className="text-sm font-medium">Appointments</span>
            </div>
            <div className="text-2xl font-bold text-purple-600">{teamTotals.appointments}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Sales</span>
            </div>
            <div className="text-2xl font-bold text-green-600">{teamTotals.sales}</div>
          </div>
          <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
            <div className="flex items-center gap-2 text-gray-600 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-sm font-medium">Revenue</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              ${(teamTotals.revenue / 1000).toFixed(0)}k
            </div>
          </div>
        </div>

        {/* Setters */}
        <div className="space-y-6">
          {setters.map((setter, index) => {
            const metrics = calculateMetrics(setter);
            const convPerf = getPerformanceLevel(metrics.conversationRate, 'conversation');
            const apptPerf = getPerformanceLevel(metrics.appointmentRate, 'appointment');
            const closePerf = getPerformanceLevel(metrics.closeRate, 'close');

            return (
              <div key={index} className="bg-white rounded-xl shadow-lg border border-gray-200 p-6">
                {/* Setter Header */}
                <div className="flex items-center justify-between mb-6">
                  <input
                    type="text"
                    value={setter.name}
                    onChange={(e) => updateSetter(index, 'name', e.target.value)}
                    className="text-2xl font-bold text-gray-900 bg-transparent border-b-2 border-transparent hover:border-gray-300 focus:border-blue-500 focus:outline-none px-2 py-1"
                  />
                  {setters.length > 1 && (
                    <button
                      onClick={() => removeSetter(index)}
                      className="text-red-500 hover:text-red-600 text-sm font-medium"
                    >
                      Remove
                    </button>
                  )}
                </div>

                {/* Input Grid */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Knocks</label>
                    <input
                      type="number"
                      value={setter.knocks || ''}
                      onChange={(e) => updateSetter(index, 'knocks', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Conversations</label>
                    <input
                      type="number"
                      value={setter.conversations || ''}
                      onChange={(e) => updateSetter(index, 'conversations', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Appointments</label>
                    <input
                      type="number"
                      value={setter.appointments || ''}
                      onChange={(e) => updateSetter(index, 'appointments', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Sales</label>
                    <input
                      type="number"
                      value={setter.sales || ''}
                      onChange={(e) => updateSetter(index, 'sales', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="0"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Avg Deal ($)</label>
                    <input
                      type="number"
                      value={setter.avgDealSize || ''}
                      onChange={(e) => updateSetter(index, 'avgDealSize', parseInt(e.target.value) || 0)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                      placeholder="25000"
                    />
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Conversation Rate</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${convPerf.color}`}>
                        {convPerf.label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {metrics.conversationRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {setter.conversations} / {setter.knocks} doors
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Appointment Rate</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${apptPerf.color}`}>
                        {apptPerf.label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {metrics.appointmentRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {setter.appointments} / {setter.conversations} convos
                    </div>
                  </div>

                  <div className="bg-gray-50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-600">Close Rate</span>
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${closePerf.color}`}>
                        {closePerf.label}
                      </span>
                    </div>
                    <div className="text-2xl font-bold text-gray-900">
                      {metrics.closeRate.toFixed(1)}%
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {setter.sales} / {setter.appointments} appts
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
                    <span className="text-sm font-medium text-green-700">Total Revenue</span>
                    <div className="text-2xl font-bold text-green-600 mt-1">
                      ${metrics.revenue.toLocaleString()}
                    </div>
                    <div className="text-xs text-green-600 mt-1">
                      {setter.sales} sales × ${setter.avgDealSize.toLocaleString()}
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-blue-50 to-indigo-50 rounded-lg p-4 border border-blue-200">
                    <span className="text-sm font-medium text-blue-700">Revenue/Knock</span>
                    <div className="text-2xl font-bold text-blue-600 mt-1">
                      ${metrics.revenuePerKnock.toFixed(0)}
                    </div>
                    <div className="text-xs text-blue-600 mt-1">
                      Overall efficiency
                    </div>
                  </div>

                  <div className="bg-gradient-to-br from-purple-50 to-pink-50 rounded-lg p-4 border border-purple-200">
                    <span className="text-sm font-medium text-purple-700">Overall Conversion</span>
                    <div className="text-2xl font-bold text-purple-600 mt-1">
                      {metrics.overallConversion.toFixed(2)}%
                    </div>
                    <div className="text-xs text-purple-600 mt-1">
                      Knock → Sale rate
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Add Setter Button */}
        <button
          onClick={addSetter}
          className="w-full mt-6 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl shadow-lg transition-colors"
        >
          + Add Another Setter
        </button>

        {/* Benchmarks */}
        <div className="mt-8 bg-white rounded-xl p-6 shadow-lg border border-gray-200">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Industry Benchmarks (Solar)</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="font-semibold text-gray-700 mb-2">Conversation Rate</div>
              <div className="text-gray-600">• Excellent: 40%+</div>
              <div className="text-gray-600">• Good: 25-40%</div>
              <div className="text-gray-600">• Average: 15-25%</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-2">Appointment Rate</div>
              <div className="text-gray-600">• Excellent: 50%+</div>
              <div className="text-gray-600">• Good: 35-50%</div>
              <div className="text-gray-600">• Average: 20-35%</div>
            </div>
            <div>
              <div className="font-semibold text-gray-700 mb-2">Close Rate</div>
              <div className="text-gray-600">• Excellent: 30%+</div>
              <div className="text-gray-600">• Good: 20-30%</div>
              <div className="text-gray-600">• Average: 10-20%</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
