'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Menu, X, Shield, Map, UserPlus, Filter, Users, Settings,
  Wand2, LogOut, ChevronRight, BarChart3
} from 'lucide-react';
import { User, canManageUsers, canAssignLeads, canSeeAllLeads } from '@/app/types';
import { getDispositionsAsync } from '@/app/utils/dispositions';
import { signOut } from 'firebase/auth';
import { auth } from '@/app/utils/firebase';

interface AppMenuProps {
  currentUser: User | null;
  onAssignClick: () => void;
  setterFilter: string;
  onFilterChange: (value: string) => void;
  solarFilter: 'all' | 'solid' | 'good' | 'great';
  onSolarFilterChange: (value: 'all' | 'solid' | 'good' | 'great') => void;
  dispositionFilter: string;
  onDispositionFilterChange: (value: string) => void;
  users: any[];
  goodLeads: any[];
}

export default function AppMenu({
  currentUser,
  onAssignClick,
  setterFilter,
  onFilterChange,
  solarFilter,
  onSolarFilterChange,
  dispositionFilter,
  onDispositionFilterChange,
  users,
  goodLeads,
}: AppMenuProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [dispositions, setDispositions] = useState<any[]>([]);
  
  // Load dispositions
  useEffect(() => {
    getDispositionsAsync().then(setDispositions);
  }, []);

  if (!currentUser) return null;

  const menuItems = [
    // Everyone - Dashboard
    {
      icon: BarChart3,
      label: 'Daily Dashboard',
      description: 'View today\'s stats',
      onClick: () => {
        router.push('/dashboard');
        setIsOpen(false);
      },
      color: 'from-teal-500 to-teal-600',
      iconColor: 'text-teal-600',
      bgColor: 'bg-teal-50',
    },
    
    // Manager/Admin features
    ...(canAssignLeads(currentUser.role) ? [{
      icon: UserPlus,
      label: 'Assign Leads',
      description: 'Manual & territory assignment',
      onClick: () => {
        onAssignClick();
        setIsOpen(false);
      },
      color: 'from-purple-500 to-purple-600',
      iconColor: 'text-purple-600',
      bgColor: 'bg-purple-50',
    }] : []),
    
    ...(canAssignLeads(currentUser.role) ? [{
      icon: Wand2,
      label: 'Auto-Assign',
      description: 'AI-powered distribution',
      onClick: () => {
        router.push('/?autoassign=true');
        setIsOpen(false);
      },
      color: 'from-indigo-500 to-indigo-600',
      iconColor: 'text-indigo-600',
      bgColor: 'bg-indigo-50',
    }] : []),
    
    ...(canAssignLeads(currentUser.role) ? [{
      icon: Map,
      label: 'Territories',
      description: 'Manage team regions',
      onClick: () => {
        router.push('/territories');
        setIsOpen(false);
      },
      color: 'from-blue-500 to-blue-600',
      iconColor: 'text-blue-600',
      bgColor: 'bg-blue-50',
    }] : []),
    
    // Admin features
    ...(canManageUsers(currentUser.role) ? [{
      icon: Shield,
      label: 'Admin Panel',
      description: 'User management & settings',
      onClick: () => {
        router.push('/admin');
        setIsOpen(false);
      },
      color: 'from-red-500 to-red-600',
      iconColor: 'text-red-600',
      bgColor: 'bg-red-50',
    }] : []),
    
    // Everyone
    {
      icon: Users,
      label: 'My Profile',
      description: 'View your stats',
      onClick: () => {
        setIsOpen(false);
      },
      color: 'from-gray-500 to-gray-600',
      iconColor: 'text-gray-600',
      bgColor: 'bg-gray-50',
    },
  ];

  return (
    <>
      {/* Hamburger Button - Flat Design */}
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="flex items-center justify-center w-10 h-10 bg-[#F7FAFC] hover:bg-[#FF5F5A] border border-[#E2E8F0] rounded-lg transition-all duration-150"
      >
        <Menu className="w-5 h-5 text-[#718096] hover:text-white transition-colors" />
      </button>

      {/* Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-black/40 z-50 transition-opacity duration-300 animate-fade-in"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Slide-out Menu - Clean White */}
      <div 
        className={`fixed top-0 right-0 bottom-0 w-full sm:w-96 max-w-[400px] bg-white border-l border-[#E2E8F0] z-50 transform transition-transform duration-300 ease-out ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
        style={{
          boxShadow: isOpen ? '-4px 0 12px rgba(0, 0, 0, 0.08)' : 'none',
        }}
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-[#E2E8F0] p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-[#2D3748]">Menu</h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="p-2 hover:bg-[#F7FAFC] rounded-lg transition-colors"
            >
              <X className="w-5 h-5 text-[#718096]" />
            </button>
          </div>
          
          {/* User Info */}
          <div className="bg-[#F7FAFC] rounded-lg p-4 border border-[#E2E8F0]">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-lg flex items-center justify-center text-white font-bold text-lg"
                style={{ backgroundColor: currentUser.color }}
              >
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-[#2D3748] truncate">{currentUser.name}</div>
                <div className="text-sm text-[#718096] capitalize">{currentUser.role}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="overflow-y-auto h-full pb-32">
          {/* Filter Section */}
          <div className="p-6 border-b border-[#E2E8F0] space-y-4">
            {/* Setter Filter - Managers/Admins only */}
            {canSeeAllLeads(currentUser.role) && (
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Filter className="w-4 h-4 text-[#718096]" />
                  <label className="text-sm font-semibold text-[#2D3748]">
                    Filter by Setter
                  </label>
                </div>
                <select
                  value={setterFilter}
                  onChange={(e) => {
                    onFilterChange(e.target.value);
                  }}
                  className="w-full px-4 py-3 bg-white border border-[#E2E8F0] rounded-lg font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-3 focus:ring-[#FF5F5A]/10 transition-all"
                >
                  <option value="all">All Setters</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name} ({goodLeads.filter(l => l.claimedBy === user.id).length})
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Solar Score Filter - Everyone */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">☀️</span>
                <label className="text-sm font-semibold text-[#2D3748]">
                  Filter by Solar Score
                </label>
              </div>
              <select
                value={solarFilter}
                onChange={(e) => {
                  onSolarFilterChange(e.target.value as 'all' | 'solid' | 'good' | 'great');
                }}
                className="w-full px-4 py-3 bg-white border border-[#E2E8F0] rounded-lg font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-3 focus:ring-[#FF5F5A]/10 transition-all"
              >
                <option value="all">All Solar Scores</option>
                <option value="solid">⭐ Solid (60-74)</option>
                <option value="good">⭐⭐ Good (75-84)</option>
                <option value="great">⭐⭐⭐ Great (85+)</option>
              </select>
            </div>
            
            {/* Disposition Filter - Everyone */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">📋</span>
                <label className="text-sm font-semibold text-[#2D3748]">
                  Filter by Disposition
                </label>
              </div>
              <select
                value={dispositionFilter}
                onChange={(e) => {
                  onDispositionFilterChange(e.target.value);
                  setIsOpen(false);
                }}
                className="w-full px-4 py-3 bg-white border border-[#E2E8F0] rounded-lg font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-3 focus:ring-[#FF5F5A]/10 transition-all"
              >
                <option value="all">All Dispositions</option>
                {dispositions.map(dispo => (
                  <option key={dispo.id} value={dispo.name}>
                    {dispo.emoji} {dispo.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Navigation Items */}
          <div className="p-4 space-y-2">
            {menuItems.map((item, index) => (
              <button
                key={index}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  item.onClick();
                }}
                className="w-full flex items-center gap-3 p-4 hover:bg-[#F7FAFC] border border-transparent hover:border-[#E2E8F0] rounded-lg transition-all duration-150"
              >
                <div className={`p-2.5 ${item.bgColor} rounded-lg`}>
                  <item.icon className={`w-5 h-5 ${item.iconColor}`} />
                </div>
                <div className="flex-1 text-left min-w-0">
                  <div className="font-semibold text-[#2D3748] truncate">{item.label}</div>
                  <div className="text-xs text-[#718096] truncate">{item.description}</div>
                </div>
                <ChevronRight className="w-4 h-4 text-[#E2E8F0] group-hover:text-[#FF5F5A] flex-shrink-0" />
              </button>
            ))}
          </div>

          {/* Logout Section */}
          <div className="p-4 border-t border-[#E2E8F0]">
            <button
              type="button"
              onClick={async () => {
                try {
                  if (auth) {
                    await signOut(auth);
                  }
                  router.push('/login');
                  setIsOpen(false);
                } catch (error) {
                  console.error('Logout error:', error);
                  alert('Failed to logout. Please try again.');
                }
              }}
              className="w-full flex items-center gap-3 p-4 hover:bg-[#FED7D7] rounded-lg transition-colors group"
            >
              <div className="p-2.5 bg-[#FED7D7] group-hover:bg-[#FC8181] rounded-lg transition-colors">
                <LogOut className="w-5 h-5 text-[#E53E3E] group-hover:text-white transition-colors" />
              </div>
              <div className="flex-1 text-left">
                <div className="font-semibold text-[#2D3748] group-hover:text-[#E53E3E] transition-colors">Logout</div>
                <div className="text-xs text-[#718096]">Sign out of your account</div>
              </div>
              <ChevronRight className="w-4 h-4 text-[#E2E8F0] group-hover:text-[#E53E3E] flex-shrink-0 transition-colors" />
            </button>
          </div>
        </div>
      </div>

    </>
  );
}
