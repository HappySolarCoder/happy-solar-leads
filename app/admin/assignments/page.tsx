'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, UserPlus, MapPin, Clock, TrendingUp } from 'lucide-react';

export default function AssignmentsPage() {
  const router = useRouter();

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push('/admin')}
            className="flex items-center gap-2 text-[#718096] hover:text-[#2D3748] mb-4 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Admin
          </button>
          <h1 className="text-3xl font-bold text-[#2D3748]">Lead Assignment Rules</h1>
          <p className="text-[#718096] mt-2">Automate lead distribution with smart rules and workflows</p>
        </div>

        {/* Coming Soon Card */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center">
          <div className="w-20 h-20 bg-[#FF5F5A]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <UserPlus className="w-10 h-10 text-[#FF5F5A]" />
          </div>
          <h2 className="text-2xl font-bold text-[#2D3748] mb-3">Coming Soon</h2>
          <p className="text-[#718096] max-w-md mx-auto mb-8">
            Advanced assignment automation and rule-based workflows are under development.
          </p>

          {/* Features List */}
          <div className="max-w-2xl mx-auto text-left bg-[#F7FAFC] rounded-xl p-6 border border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-[#FF5F5A]" />
              Planned Features
            </h3>
            <ul className="space-y-3 text-sm text-[#718096]">
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Automatic assignment based on territory, skill level, or workload</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Round-robin distribution among team members</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Priority rules (VIP leads, high solar scores, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Time-based reassignment (stale leads auto-reassign)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Performance-based distribution (top performers get more leads)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Custom assignment workflows with conditions</span>
              </li>
            </ul>
          </div>

          {/* Current Features */}
          <div className="mt-8 max-w-2xl mx-auto">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 text-left flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#FF5F5A]" />
              Available Now
            </h3>
            <div className="grid grid-cols-1 gap-4">
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-[#2D3748]">Manual Assignment</div>
                  <button 
                    onClick={() => router.push('/?assign=true')}
                    className="text-xs text-[#FF5F5A] hover:underline"
                  >
                    Open →
                  </button>
                </div>
                <div className="text-xs text-[#718096]">Click leads on map to select and assign to users</div>
              </div>
              
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-[#2D3748]">Territory Drawing</div>
                  <button 
                    onClick={() => router.push('/?assign=true')}
                    className="text-xs text-[#FF5F5A] hover:underline"
                  >
                    Open →
                  </button>
                </div>
                <div className="text-xs text-[#718096]">Draw areas on map to assign all leads in territory</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
