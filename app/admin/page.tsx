'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Users, Shield, MapPin, Database, BarChart3, Upload, Target, 
  FileText, TrendingUp, Settings, ArrowRight, ChevronRight
} from 'lucide-react';
import { 
  User, UserRole, canManageUsers 
} from '@/app/types';
import { 
  getUsersAsync, getCurrentUserAsync 
} from '@/app/utils/storage';

export default function AdminPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Load current user and check permissions
  useEffect(() => {
    async function loadData() {
      const user = await getCurrentUserAsync();
      
      if (!user || !canManageUsers(user.role)) {
        // Not admin - redirect to home
        router.push('/');
        return;
      }
      
      setCurrentUser(user);
      const allUsers = await getUsersAsync();
      setUsers(allUsers);
      setIsLoading(false);
    }
    
    loadData();
  }, [router]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7FAFC]">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading admin panel...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  const stats = {
    totalUsers: users.length,
    setters: users.filter(u => u.role === 'setter').length,
    closers: users.filter(u => u.role === 'closer').length,
    managers: users.filter(u => u.role === 'manager').length,
    admins: users.filter(u => u.role === 'admin').length,
    activeUsers: users.filter(u => u.isActive).length,
    territories: new Set(users.map(u => u.territory).filter(Boolean)).size,
  };

  return (
    <div className="min-h-screen bg-[#F7FAFC]">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0]">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-[#FF5F5A]/10 rounded-lg">
                <Shield className="w-7 h-7 text-[#FF5F5A]" />
              </div>
              <div>
                <h1 className="text-3xl font-bold text-[#2D3748]">Admin Panel</h1>
                <p className="text-sm text-[#718096]">System configuration and management</p>
              </div>
            </div>
            <button
              onClick={() => router.push('/')}
              className="px-5 py-2.5 text-[#2D3748] hover:bg-[#F7FAFC] rounded-lg font-medium transition-colors border border-[#E2E8F0]"
            >
              ← Back to App
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#718096] mb-1">Total Users</p>
                <p className="text-3xl font-bold text-[#2D3748]">{stats.totalUsers}</p>
              </div>
              <Users className="w-10 h-10 text-[#FF5F5A]" />
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#718096] mb-1">Active Users</p>
                <p className="text-3xl font-bold text-[#2D3748]">{stats.activeUsers}</p>
              </div>
              <Users className="w-10 h-10 text-[#48BB78]" />
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#718096] mb-1">Territories</p>
                <p className="text-3xl font-bold text-[#2D3748]">{stats.territories}</p>
              </div>
              <MapPin className="w-10 h-10 text-[#4299E1]" />
            </div>
          </div>

          <div className="bg-white border border-[#E2E8F0] rounded-lg p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-[#718096] mb-1">Field Team</p>
                <p className="text-3xl font-bold text-[#2D3748]">{stats.setters + stats.closers}</p>
              </div>
              <Target className="w-10 h-10 text-[#ED8936]" />
            </div>
          </div>
        </div>

        {/* Section 1: User Management */}
        <section className="mb-8">
          <h2 className="text-xl font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <Users className="w-6 h-6 text-[#FF5F5A]" />
            User Management
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => router.push('/admin/users')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#FF5F5A]/10 rounded-lg">
                  <Users className="w-6 h-6 text-[#FF5F5A]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Manage Users</h3>
              <p className="text-sm text-[#718096]">
                View, edit, and manage all user accounts ({stats.totalUsers} total)
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/roles')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#4299E1]/10 rounded-lg">
                  <Shield className="w-6 h-6 text-[#4299E1]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Role Permissions</h3>
              <p className="text-sm text-[#718096]">
                Configure permissions for setters, closers, managers, and admins
              </p>
            </button>
          </div>
        </section>

        {/* Section 2: Territory Customization */}
        <section className="mb-8">
          <h2 className="text-xl font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <MapPin className="w-6 h-6 text-[#FF5F5A]" />
            Territory Customization
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => router.push('/territories')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#4299E1]/10 rounded-lg">
                  <MapPin className="w-6 h-6 text-[#4299E1]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Manage Territories</h3>
              <p className="text-sm text-[#718096]">
                Create, edit, and assign territories to team members ({stats.territories} active)
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/assignments')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#48BB78]/10 rounded-lg">
                  <Target className="w-6 h-6 text-[#48BB78]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Lead Assignments</h3>
              <p className="text-sm text-[#718096]">
                View and manage lead distribution across territories
              </p>
            </button>
          </div>
        </section>

        {/* Section 3: Data Management */}
        <section className="mb-8">
          <h2 className="text-xl font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <Database className="w-6 h-6 text-[#FF5F5A]" />
            Data Management
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => router.push('/admin/dispositions')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#8B5CF6]/10 rounded-lg">
                  <Settings className="w-6 h-6 text-[#8B5CF6]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Dispositions</h3>
              <p className="text-sm text-[#718096]">
                Customize status options and door knock tracking
              </p>
            </button>

            <button
              onClick={() => router.push('/')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#ED8936]/10 rounded-lg">
                  <Upload className="w-6 h-6 text-[#ED8936]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Upload Leads</h3>
              <p className="text-sm text-[#718096]">
                Import CSV files with address data and solar info
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/data-cleanup')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#F56565]/10 rounded-lg">
                  <Database className="w-6 h-6 text-[#F56565]" />
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Data Cleanup</h3>
              <p className="text-sm text-[#718096]">
                Bulk delete, merge duplicates, and data maintenance
              </p>
            </button>
          </div>
        </section>

        {/* Section 4: Dashboards & Reporting */}
        <section>
          <h2 className="text-xl font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-[#FF5F5A]" />
            Dashboards & Reporting
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => router.push('/admin/team-dashboard')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group opacity-50 cursor-not-allowed"
              disabled
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#4299E1]/10 rounded-lg">
                  <TrendingUp className="w-6 h-6 text-[#4299E1]" />
                </div>
                <span className="text-xs px-2 py-1 bg-[#718096]/10 text-[#718096] rounded font-medium">Coming Soon</span>
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Team Dashboard</h3>
              <p className="text-sm text-[#718096]">
                Performance metrics, leaderboards, and activity tracking
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/analytics')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group opacity-50 cursor-not-allowed"
              disabled
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#48BB78]/10 rounded-lg">
                  <BarChart3 className="w-6 h-6 text-[#48BB78]" />
                </div>
                <span className="text-xs px-2 py-1 bg-[#718096]/10 text-[#718096] rounded font-medium">Coming Soon</span>
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Analytics</h3>
              <p className="text-sm text-[#718096]">
                Conversion rates, revenue tracking, and territory insights
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/reports')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group opacity-50 cursor-not-allowed"
              disabled
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#8B5CF6]/10 rounded-lg">
                  <FileText className="w-6 h-6 text-[#8B5CF6]" />
                </div>
                <span className="text-xs px-2 py-1 bg-[#718096]/10 text-[#718096] rounded font-medium">Coming Soon</span>
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Custom Reports</h3>
              <p className="text-sm text-[#718096]">
                Generate and export custom data reports
              </p>
            </button>
          </div>
        </section>

        {/* Section 5: Gamification & Motivation */}
        <section className="mt-8">
          <h2 className="text-xl font-bold text-[#2D3748] mb-4 flex items-center gap-2">
            <span className="text-2xl">🎮</span>
            Gamification & Motivation
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button
              onClick={() => router.push('/admin/easter-eggs')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-gradient-to-br from-[#FF5F5A] to-[#F27141] rounded-lg">
                  <span className="text-2xl">🥚</span>
                </div>
                <ArrowRight className="w-5 h-5 text-[#718096] group-hover:text-[#FF5F5A] group-hover:translate-x-1 transition-all" />
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Easter Eggs</h3>
              <p className="text-sm text-[#718096]">
                Random rewards & treasure hunts to motivate team behavior
              </p>
            </button>

            <button
              onClick={() => router.push('/admin/leaderboards')}
              className="bg-white border border-[#E2E8F0] rounded-lg p-6 hover:border-[#FF5F5A] hover:shadow-md transition-all text-left group opacity-50 cursor-not-allowed"
              disabled
            >
              <div className="flex items-center justify-between mb-3">
                <div className="p-3 bg-[#F6AD55]/10 rounded-lg">
                  <span className="text-2xl">🏆</span>
                </div>
                <span className="text-xs px-2 py-1 bg-[#718096]/10 text-[#718096] rounded font-medium">Coming Soon</span>
              </div>
              <h3 className="font-semibold text-[#2D3748] mb-1">Leaderboards</h3>
              <p className="text-sm text-[#718096]">
                Rankings, achievements, and performance tracking
              </p>
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
