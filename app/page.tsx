'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Plus, Upload, Users, Menu, X, Map as MapIcon, List } from 'lucide-react';
import LeadList from '@/app/components/LeadList';
import UploadModal from '@/app/components/UploadModal';
import UserOnboarding from '@/app/components/UserOnboarding';
import LeadDetail from '@/app/components/LeadDetail';
import { getLeads, getCurrentUser, saveCurrentUser } from '@/app/utils/storage';
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

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Stats
  const stats = {
    total: leads.length,
    unclaimed: leads.filter(l => l.status === 'unclaimed').length,
    claimed: leads.filter(l => l.status === 'claimed').length,
    interested: leads.filter(l => l.status === 'interested').length,
    appointments: leads.filter(l => l.status === 'appointment').length,
    sales: leads.filter(l => l.status === 'sale').length,
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
            <StatPill label="Total" value={stats.total} color="gray" />
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

          {/* User Info */}
          {currentUser && (
            <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
              <div 
                className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                style={{ backgroundColor: currentUser.color }}
              >
                {currentUser.name.charAt(0).toUpperCase()}
              </div>
              <span className="hidden md:block text-sm font-medium text-gray-700">
                {currentUser.name.split(' ')[0]}
              </span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Lead List Sidebar */}
        {(viewMode === 'split' || viewMode === 'list') && (
          <aside className={`${viewMode === 'split' ? 'w-96' : 'w-full max-w-md'} flex-shrink-0 border-r border-gray-200 bg-white`}>
            <LeadList
              leads={leads}
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
              leads={leads}
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
    </div>
  );
}

// Stat Pill Component
function StatPill({ label, value, color }: { label: string; value: number; color: string }) {
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
