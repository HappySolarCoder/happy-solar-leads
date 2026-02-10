'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Upload, Users, Menu, X, Map as MapIcon, List, Navigation, Wand2 } from 'lucide-react';
import LeadList from '@/app/components/LeadList';
import UploadModal from '@/app/components/UploadModal';
import UserOnboarding from '@/app/components/UserOnboarding';
import LeadDetail from '@/app/components/LeadDetail';
import AutoAssignPanel from '@/app/components/AutoAssignPanel';
import UserSwitcher from '@/app/components/UserSwitcher';
import { getLeads, getCurrentUser, getUsers, saveCurrentUser } from '@/app/utils/storage';
import { Lead, User, STATUS_LABELS, STATUS_COLORS } from '@/app/types';

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
  const [leads, setLeads] = useState<Lead[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showUserOnboarding, setShowUserOnboarding] = useState(false);
  const [viewMode, setViewMode] = useState<'split' | 'map' | 'list'>('split');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [setterFilter, setSetterFilter] = useState<string>('all');
  // Load data on mount
  useEffect(() => {
    const loadedLeads = getLeads();
    setLeads(loadedLeads);

    const user = getCurrentUser();
    if (user) {
      setCurrentUser(user);
    } else {
      setShowUserOnboarding(true);
    }
  }, []);

  // Refresh leads when they change
  const refreshLeads = useCallback(() => {
    setLeads(getLeads());
  }, []);

  // Handle user completion
  const handleUserComplete = (user: User) => {
    setCurrentUser(user);
    setShowUserOnboarding(false);
  };

  // Handle lead selection from map
  const handleLeadSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setShowLeadDetail(true);
  };

  // Handle upload complete
  const handleUploadComplete = (count: number) => {
    refreshLeads();
    setShowUploadModal(false);
    // Force reload to ensure fresh data from localStorage
    setTimeout(() => window.location.reload(), 100);
  };

  // Clear all leads (for testing)
  const handleClearAllLeads = () => {
    if (confirm('Delete ALL leads? This cannot be undone.')) {
      localStorage.removeItem('happysolar_leads');
      localStorage.removeItem('happy_solar_geocode_cache');
      setLeads([]);
      refreshLeads();
    }
  };

  // Get users for route builder
  const [users, setUsers] = useState<User[]>([]);
  useEffect(() => {
    setUsers(getUsers());
  }, []);

  // Filter leads for main display (exclude poor solar leads)
  const goodLeads = leads.filter(l => l.solarCategory !== 'poor');
  const poorLeads = leads.filter(l => l.solarCategory === 'poor');
  
  // Filter by setter if selected
  const filteredLeads = setterFilter === 'all' 
    ? goodLeads 
    : goodLeads.filter(l => l.claimedBy === setterFilter);

  // Delete a poor lead
  const handleDeletePoorLead = (leadId: string) => {
    if (confirm('Delete this poor solar lead?')) {
      const leads = getLeads();
      const filtered = leads.filter(l => l.id !== leadId);
      localStorage.setItem('happysolar_leads', JSON.stringify(filtered));
      refreshLeads();
    }
  };

  // Delete all poor leads
  const handleDeleteAllPoorLeads = () => {
    if (confirm(`Delete all ${poorLeads.length} poor solar leads? This cannot be undone.`)) {
      const filtered = leads.filter(l => l.solarCategory !== 'poor');
      localStorage.setItem('happysolar_leads', JSON.stringify(filtered));
      refreshLeads();
    }
  };

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Stats - based on good leads only
  const stats = {
    total: leads.length,
    tested: goodLeads.length,
    poor: poorLeads.length,
    unclaimed: goodLeads.filter(l => l.status === 'unclaimed').length,
    claimed: goodLeads.filter(l => l.status === 'claimed').length,
    interested: goodLeads.filter(l => l.status === 'interested').length,
    appointments: goodLeads.filter(l => l.status === 'appointment').length,
    sales: goodLeads.filter(l => l.status === 'sale').length,
  };

  return (
    <div className="h-screen flex flex-col bg-gray-100 overflow-hidden">
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

      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between z-10">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-gray-900">
            Happy Solar <span className="text-blue-500">Leads</span>
          </h1>
          
          {/* Stats Pills */}
          <div className="hidden md:flex items-center gap-2 ml-8">
            <StatPill label="Tested" value={`${stats.tested}/${stats.total}`} color="#3b82f6" />
            {stats.poor > 0 && (
              <StatPill label="Poor" value={stats.poor} color="#ef4444" />
            )}
            <StatPill label="Unclaimed" value={stats.unclaimed} color="#22c55e" />
            <StatPill label="Interested" value={stats.interested} color="#3b82f6" />
            <StatPill label="Appointments" value={stats.appointments} color="#8b5cf6" />
            <StatPill label="Sales" value={stats.sales} color="#10b981" />
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* View Mode Toggle */}
          <div className="hidden sm:flex items-center bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setViewMode('split')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'split' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
              }`}
            >
              Split
            </button>
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'map' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
              }`}
            >
              Map
            </button>
            <button
              onClick={() => setViewMode('list')}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'list' ? 'bg-white shadow text-gray-900' : 'text-gray-500'
              }`}
            >
              List
            </button>
          </div>

          {/* Upload Button */}
          <button
            onClick={() => setShowUploadModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg font-medium transition-colors"
          >
            <Upload className="w-4 h-4" />
            <span className="hidden sm:inline">Upload Leads</span>
          </button>

          {/* AI Auto-Assign Button */}
          <AutoAssignPanel onComplete={refreshLeads} />

          {/* Setter Filter */}
          <select
            value={setterFilter}
            onChange={(e) => setSetterFilter(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Setters</option>
            {users.map(user => (
              <option key={user.id} value={user.id}>
                {user.name} ({goodLeads.filter(l => l.claimedBy === user.id).length})
              </option>
            ))}
          </select>

          {/* Clear All (for testing) */}
          {leads.length > 0 && (
            <button
              onClick={handleClearAllLeads}
              className="px-3 py-2 text-red-600 hover:bg-red-50 rounded-lg font-medium text-sm transition-colors"
              title="Delete all leads"
            >
              🗑️ Clear All
            </button>
          )}

          {/* Unclaim All (for testing) */}
          {goodLeads.some(l => l.claimedBy) && (
            <button
              onClick={() => {
                if (confirm('Unclaim all leads? This will make them available for auto-assignment.')) {
                  const allLeads = getLeads();
                  const reset = allLeads.map(l => ({
                    ...l,
                    claimedBy: undefined,
                    claimedAt: undefined,
                    assignedTo: undefined,
                    assignedAt: undefined,
                    status: 'unclaimed',
                  }));
                  localStorage.setItem('happysolar_leads', JSON.stringify(reset));
                  refreshLeads();
                }
              }}
              className="px-3 py-2 text-orange-600 hover:bg-orange-50 rounded-lg font-medium text-sm transition-colors"
              title="Unclaim all leads"
            >
              ↩️ Unclaim All
            </button>
          )}

          {/* User Switcher */}
          <UserSwitcher onUserChange={refreshLeads} />
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
              onLeadClick={handleLeadSelect}
              selectedLeadId={selectedLeadId}
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
