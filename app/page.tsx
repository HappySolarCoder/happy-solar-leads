'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Upload, Users, Menu, X, Map as MapIcon, List, Navigation, Wand2, UserPlus, Shield } from 'lucide-react';
import { useRouter } from 'next/navigation';
import LeadList from '@/app/components/LeadList';
import UploadModal from '@/app/components/UploadModal';
import UserOnboarding from '@/app/components/UserOnboarding';
import LeadDetail from '@/app/components/LeadDetail';
import UserSwitcher from '@/app/components/UserSwitcher';
import LeadAssignmentPanel from '@/app/components/LeadAssignmentPanel';
import AppMenu from '@/app/components/AppMenu';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, LeadStatus, STATUS_LABELS, STATUS_COLORS, canUploadLeads, canSeeAllLeads, canAssignLeads, canManageUsers } from '@/app/types';
import { ensureUserColors } from '@/app/utils/userColors';

// Dynamic import for map (client-side only)
const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-gray-100 rounded-xl">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-gray-500">Loading map...</p>
      </div>
    </div>
  ),
});

export default function Home() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showUserOnboarding, setShowUserOnboarding] = useState(false);
  const [showAssignmentPanel, setShowAssignmentPanel] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'none' | 'manual' | 'territory'>('none');
  const [selectedLeadIdsForAssignment, setSelectedLeadIdsForAssignment] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list'>('split');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [setterFilter, setSetterFilter] = useState<string>('all');
  const [solarFilter, setSolarFilter] = useState<'all' | 'solid' | 'good' | 'great'>('all');
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  
  // Mobile detection - redirect to mobile view (but allow admin pages)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      const isSmallScreen = window.innerWidth < 768;
      const isAdminPage = window.location.pathname.startsWith('/admin');
      
      // If mobile device AND not explicitly requesting desktop view AND not on admin page
      if ((isMobile || isSmallScreen) && !window.location.search.includes('desktop=true') && !isAdminPage) {
        router.push('/mobile');
      }
    }
  }, [router]);
  
  // Load data on mount - optimized for large datasets
  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      
      if (!user) {
        // Not authenticated - redirect to login
        router.push('/login');
        return;
      }
      
      if (user.approvalStatus === 'pending') {
        router.push('/pending-approval');
        return;
      }
      
      setCurrentUser(user);
      
      // Show map immediately with empty leads, then load in background
      // This prevents white screen while loading 18K+ leads
      setLeads([]);
      
      // Load leads in background (non-blocking)
      setTimeout(async () => {
        console.log('[Page] Loading leads in background...');
        const loadedLeads = await getLeadsAsync();
        console.log('[Page] Loaded', loadedLeads.length, 'leads');
        setLeads(loadedLeads);
      }, 100);
    }
    loadData();
  }, [router]);

  // Refresh leads when they change
  const refreshLeads = useCallback(async () => {
    const loadedLeads = await getLeadsAsync();
    setLeads(loadedLeads);
  }, []);

  // Handle user completion
  const handleUserComplete = (user: User) => {
    setCurrentUser(user);
    setShowUserOnboarding(false);
  };

  // Handle lead selection from map
  const handleLeadSelect = (lead: Lead) => {
    // If in assignment mode, toggle lead selection
    if (assignmentMode === 'manual') {
      setSelectedLeadIdsForAssignment(prev => {
        if (prev.includes(lead.id)) {
          return prev.filter(id => id !== lead.id);
        } else {
          return [...prev, lead.id];
        }
      });
    } else {
      // Normal mode - show lead detail
      setSelectedLeadId(lead.id);
      setShowLeadDetail(true);
    }
  };

  // Handle assignment mode change
  const handleAssignmentModeChange = (mode: 'none' | 'manual' | 'territory') => {
    setAssignmentMode(mode);
    if (mode === 'none') {
      setSelectedLeadIdsForAssignment([]);
    }
  };

  // Handle territory drawn
  const handleTerritoryDrawn = (leadIds: string[]) => {
    setSelectedLeadIdsForAssignment(leadIds);
  };

  // Handle assignment complete
  const handleAssignmentComplete = () => {
    setShowAssignmentPanel(false);
    setAssignmentMode('none');
    setSelectedLeadIdsForAssignment([]);
    refreshLeads();
  };

  // Handle upload complete
  const handleUploadComplete = async (count: number) => {
    setShowUploadModal(false);
    // Refresh data from Firestore
    const loadedLeads = await getLeadsAsync();
    setLeads(loadedLeads);
  };

  // Clear all leads (for testing)
  const handleClearAllLeads = () => {
    if (confirm('Delete ALL leads? This cannot be undone.')) {
      localStorage.removeItem('raydar_leads');
      localStorage.removeItem('raydar_geocode_cache');
      setLeads([]);
      refreshLeads();
    }
  };

  // Get users for route builder
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    async function loadUsers() {
      const loadedUsers = await getUsersAsync();
      setUsers(loadedUsers);
    }
    loadUsers();
  }, []);

  // Role-based lead visibility
  const roleFilteredLeads = currentUser
    ? (currentUser.role === 'setter' || currentUser.role === 'closer')
      ? leads.filter(l => l.claimedBy === currentUser.id)
      : leads
    : [];

  // Filter leads for main display (exclude poor solar leads)
  const goodLeads = roleFilteredLeads.filter(l => l.solarCategory !== 'poor');
  const poorLeads = roleFilteredLeads.filter(l => l.solarCategory === 'poor');

  // Filter by setter if selected
  let filteredLeads = setterFilter === 'all'
    ? goodLeads
    : goodLeads.filter(l => l.claimedBy === setterFilter);
  
  // Filter by solar category if selected
  if (solarFilter !== 'all') {
    filteredLeads = filteredLeads.filter(l => l.solarCategory === solarFilter);
  }
  
  // Filter by disposition if selected
  if (dispositionFilter !== 'all') {
    filteredLeads = filteredLeads.filter(l => l.disposition === dispositionFilter);
  }

  // Delete a poor lead
  const handleDeletePoorLead = async (leadId: string) => {
    if (confirm('Delete this poor solar lead?')) {
      const { deleteLeadAsync } = await import('@/app/utils/storage');
      await deleteLeadAsync(leadId);
      await refreshLeads();
    }
  };

  // Delete all poor leads
  const handleDeleteAllPoorLeads = () => {
    if (confirm(`Delete all ${poorLeads.length} poor solar leads? This cannot be undone.`)) {
      const filtered = leads.filter(l => l.solarCategory !== 'poor');
      localStorage.setItem('raydar_leads', JSON.stringify(filtered));
      refreshLeads();
    }
  };

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Stats - based on good leads only
  const stats = {
    total: roleFilteredLeads.length,
    tested: goodLeads.length,
    poor: poorLeads.length,
    unclaimed: goodLeads.filter(l => l.status === 'unclaimed').length,
    claimed: goodLeads.filter(l => l.status === 'claimed').length,
    interested: goodLeads.filter(l => l.status === 'interested').length,
    appointments: goodLeads.filter(l => l.status === 'appointment').length,
    sales: goodLeads.filter(l => l.status === 'sale').length,
  };

  return (
    <div className="h-screen flex flex-col overflow-hidden max-w-full bg-white">
      {/* User Onboarding Modal */}
      <UserOnboarding
        isOpen={showUserOnboarding}
        onComplete={handleUserComplete}
      />

      {/* Upload Modal */}
      <UploadModal
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onComplete={handleUploadComplete}
      />

      {/* Lead Detail Panel */}
      {selectedLead && showLeadDetail && (
        <LeadDetail
          lead={selectedLead}
          currentUser={currentUser}
          onClose={() => {
            setShowLeadDetail(false);
            setSelectedLeadId(undefined);
          }}
          onUpdate={refreshLeads}
        />
      )}

      {/* Lead Assignment Panel */}
      <LeadAssignmentPanel
        isOpen={showAssignmentPanel}
        onClose={() => {
          setShowAssignmentPanel(false);
          setAssignmentMode('none');
          setSelectedLeadIdsForAssignment([]);
        }}
        currentUser={currentUser}
        leads={leads}
        onAssignComplete={handleAssignmentComplete}
        onModeChange={handleAssignmentModeChange}
        selectedLeadIds={selectedLeadIdsForAssignment}
        onLeadSelect={(leadId) => {
          setSelectedLeadIdsForAssignment(prev => {
            if (prev.includes(leadId)) {
              return prev.filter(id => id !== leadId);
            } else {
              return [...prev, leadId];
            }
          });
        }}
      />

      {/* Header - Clean Flat Design */}
      <header className="sticky top-0 z-30 bg-white border-b border-[#E2E8F0] shadow-sm">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 py-4">
          <div className="flex items-center justify-between gap-4">
            {/* Logo */}
            <div className="flex items-center gap-6 min-w-0 flex-1">
              <div className="flex items-center group cursor-pointer">
                {/* Mobile: Icon only */}
                <img
                  src="/raydar-icon.png"
                  alt="Raydar"
                  className="h-10 w-auto object-contain sm:hidden"
                />
                {/* Desktop: Horizontal logo */}
                <img
                  src="/raydar-horizontal.png"
                  alt="Raydar"
                  className="h-11 w-auto object-contain hidden sm:block"
                />
              </div>

              {/* Stats Pills - Flat Design */}
              <div className="hidden xl:flex items-center gap-3 ml-8">
                <div className="px-4 py-2 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <span className="text-base font-semibold text-[#2D3748]">{stats.tested}</span>
                  <span className="text-xs text-[#718096] ml-2 uppercase tracking-wide">tested</span>
                </div>
                <div className="px-4 py-2 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <span className="text-base font-semibold text-[#FF5F5A]">{stats.unclaimed}</span>
                  <span className="text-xs text-[#718096] ml-2 uppercase tracking-wide">available</span>
                </div>
                <div className="px-4 py-2 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <span className="text-base font-semibold text-[#2D3748]">{stats.appointments}</span>
                  <span className="text-xs text-[#718096] ml-2 uppercase tracking-wide">appointments</span>
                </div>
                <div className="px-4 py-2 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg">
                  <span className="text-base font-semibold text-[#48BB78]">{stats.sales}</span>
                  <span className="text-xs text-[#718096] ml-2 uppercase tracking-wide">sales</span>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
              {/* View Mode Toggle - Flat Design */}
              <div className="hidden sm:flex items-center bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg p-1">
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 ${
                    viewMode === 'split' 
                      ? 'bg-[#FF5F5A] text-white' 
                      : 'text-[#718096] hover:text-[#2D3748] hover:bg-white'
                  }`}
                >
                  Split
                </button>
                <button
                  onClick={() => setViewMode('map')}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 ${
                    viewMode === 'map' 
                      ? 'bg-[#FF5F5A] text-white' 
                      : 'text-[#718096] hover:text-[#2D3748] hover:bg-white'
                  }`}
                >
                  Map
                </button>
                <button
                  onClick={() => setViewMode('list')}
                  className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-150 ${
                    viewMode === 'list' 
                      ? 'bg-[#FF5F5A] text-white' 
                      : 'text-[#718096] hover:text-[#2D3748] hover:bg-white'
                  }`}
                >
                  List
                </button>
              </div>

              {/* Upload Button - Flat Primary Button */}
              {currentUser && canUploadLeads(currentUser.role) && (
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="flex items-center gap-2 px-4 py-3 bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-lg font-semibold transition-all duration-150 hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#FF5F5A]/25 text-sm"
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden md:inline">Upload</span>
                </button>
              )}

              {/* User Switcher */}
              <UserSwitcher onUserChange={refreshLeads} />

              {/* Hamburger Menu - Always far right */}
              <AppMenu
                currentUser={currentUser}
                onAssignClick={() => setShowAssignmentPanel(true)}
                setterFilter={setterFilter}
                onFilterChange={setSetterFilter}
                solarFilter={solarFilter}
                onSolarFilterChange={setSolarFilter}
                dispositionFilter={dispositionFilter}
                onDispositionFilterChange={setDispositionFilter}
                users={users}
                goodLeads={goodLeads}
              />
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* List Sidebar */}
        {(viewMode === 'split' || viewMode === 'list') && (
          <aside className={`${viewMode === 'split' ? 'w-96' : 'w-full max-w-md'} flex-shrink-0 border-r border-gray-200 bg-white flex flex-col`}>
            <LeadList
              leads={filteredLeads}
              selectedLeadId={selectedLeadId}
              onLeadSelect={handleLeadSelect}
              currentUserId={currentUser?.id}
            />
          </aside>
        )}

        {/* Map Area */}
        {(viewMode === 'split' || viewMode === 'map') && (
          <main className={`flex-1 relative ${viewMode === 'map' ? 'w-full' : ''}`}>
            <LeadMap
              leads={filteredLeads}
              currentUser={currentUser}
              users={ensureUserColors(users)}
              onLeadClick={handleLeadSelect}
              selectedLeadId={selectedLeadId}
              assignmentMode={assignmentMode}
              selectedLeadIdsForAssignment={selectedLeadIdsForAssignment}
              onTerritoryDrawn={handleTerritoryDrawn}
            />

            {/* Mobile Floating Action Button */}
            {viewMode === 'map' && (
              <button
                onClick={() => setViewMode('list')}
                className="absolute bottom-6 right-6 sm:hidden w-14 h-14 bg-blue-500 hover:bg-blue-600 text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105"
              >
                <List className="w-6 h-6" />
              </button>
            )}
          </main>
        )}
      </div>

      {/* Poor Solar Leads Section */}
      {poorLeads.length > 0 && (
        <div className="bg-red-50 border-t border-red-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-red-800 flex items-center gap-2">
              ❌ Poor Solar Potential ({poorLeads.length} leads)
            </h3>
            <button
              onClick={handleDeleteAllPoorLeads}
              className="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-sm"
            >
              Delete All
            </button>
          </div>

          <p className="text-sm text-red-600 mb-3">
            {poorLeads.length} of {leads.length} leads ({Math.round(poorLeads.length / leads.length * 100)}%) have poor solar potential (&lt;1300 sun hrs/yr)
          </p>

          <div className="flex flex-wrap gap-2">
            {poorLeads.map(lead => (
              <div
                key={lead.id}
                className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg border border-red-200"
              >
                <div className="flex-1">
                  <p className="font-medium text-gray-900 text-sm">{lead.name}</p>
                  <p className="text-xs text-gray-500">{lead.address}, {lead.city}</p>
                </div>
                <button
                  onClick={() => handleDeletePoorLead(lead.id)}
                  className="px-2 py-1 bg-gray-100 hover:bg-red-100 text-gray-600 hover:text-red-600 rounded text-xs"
                >
                  🗑️
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Stat Pill Component
function StatPill({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <div
      className="flex items-center gap-1.5 px-2.5 py-1 bg-gray-50 rounded-full"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <span className="text-sm font-semibold text-gray-900">{value}</span>
    </div>
  );
}
