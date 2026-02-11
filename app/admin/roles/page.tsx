'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Shield, Users, Lock } from 'lucide-react';

export default function RolesPage() {
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
          <h1 className="text-3xl font-bold text-[#2D3748]">Role Management</h1>
          <p className="text-[#718096] mt-2">Create and manage custom user roles and permissions</p>
        </div>

        {/* Coming Soon Card */}
        <div className="bg-white rounded-2xl border border-[#E2E8F0] p-12 text-center">
          <div className="w-20 h-20 bg-[#FF5F5A]/10 rounded-full flex items-center justify-center mx-auto mb-6">
            <Shield className="w-10 h-10 text-[#FF5F5A]" />
          </div>
          <h2 className="text-2xl font-bold text-[#2D3748] mb-3">Coming Soon</h2>
          <p className="text-[#718096] max-w-md mx-auto mb-8">
            Advanced role management with custom permissions is currently under development.
          </p>

          {/* Features List */}
          <div className="max-w-2xl mx-auto text-left bg-[#F7FAFC] rounded-xl p-6 border border-[#E2E8F0]">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#FF5F5A]" />
              Planned Features
            </h3>
            <ul className="space-y-3 text-sm text-[#718096]">
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Create custom roles beyond Setter/Closer/Manager/Admin</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Granular permission controls (view, edit, delete, assign, etc.)</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Team-based access controls and hierarchy</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Role templates for quick setup</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FF5F5A] mt-0.5">●</span>
                <span>Audit logs for permission changes</span>
              </li>
            </ul>
          </div>

          {/* Current Roles */}
          <div className="mt-8 max-w-2xl mx-auto">
            <h3 className="text-sm font-semibold text-[#2D3748] mb-4 text-left flex items-center gap-2">
              <Users className="w-4 h-4 text-[#FF5F5A]" />
              Current Roles Available
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="font-semibold text-[#2D3748]">Setter</div>
                <div className="text-xs text-[#718096] mt-1">Field sales rep</div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="font-semibold text-[#2D3748]">Closer</div>
                <div className="text-xs text-[#718096] mt-1">Appointment closer</div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="font-semibold text-[#2D3748]">Manager</div>
                <div className="text-xs text-[#718096] mt-1">Team lead + assignment</div>
              </div>
              <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-left">
                <div className="font-semibold text-[#2D3748]">Admin</div>
                <div className="text-xs text-[#718096] mt-1">Full system access</div>
              </div>
            </div>
            <p className="text-xs text-[#718096] mt-4">
              Manage existing role assignments in <button onClick={() => router.push('/admin/users')} className="text-[#FF5F5A] hover:underline">User Management</button>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
