'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, List, Navigation, Filter } from 'lucide-react';
import { getLeadsAsync, getCurrentUserAsync } from '@/app/utils/storage';
import { Lead, User, canSeeAllLeads } from '@/app/types';
import LeadDetail from '@/app/components/LeadDetail';

// Dynamic import for map (client-side only)
const LeadMap = dynamic(() => import('@/app/components/LeadMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-[#F7FAFC]">
      <div className="text-center">
        <div className="w-8 h-8 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-2" />
        <p className="text-sm text-[#718096]">Loading map...</p>
      </div>
    </div>
  ),
});

export default function KnockingPage() {
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeadId, setSelectedLeadId] = useState<string | undefined>();
  const [showLeadDetail, setShowLeadDetail] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'list'>('map');
  const [isLoading, setIsLoading] = useState(true);

  // Load data
  useEffect(() => {
    async function loadData() {
      const user = await getCurrentUserAsync();
      if (!user) {
        router.push('/');
        return;
      }
      setCurrentUser(user);

      const loadedLeads = await getLeadsAsync();
      setLeads(loadedLeads);
      setIsLoading(false);
    }
    loadData();
  }, [router]);

  // Refresh leads
  const refreshLeads = useCallback(async () => {
    const loadedLeads = await getLeadsAsync();
    setLeads(loadedLeads);
  }, []);

  // Handle lead selection
  const handleLeadSelect = (lead: Lead) => {
    setSelectedLeadId(lead.id);
    setShowLeadDetail(true);
  };

  // Filter leads based on user role
  const roleFilteredLeads = currentUser && !canSeeAllLeads(currentUser.role)
    ? leads.filter(l =>
        l.status === 'unclaimed' ||
        l.claimedBy === currentUser.id ||
        l.assignedTo === currentUser.id
      )
    : leads;

  // Exclude poor solar leads
  const goodLeads = roleFilteredLeads.filter(l => l.solarCategory !== 'poor');

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Stats
  const myLeads = goodLeads.filter(l => l.claimedBy === currentUser?.id).length;
  const available = goodLeads.filter(l => l.status === 'unclaimed').length;

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading leads...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Mobile Header - Compact */}
      <header className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <button
            onClick={() => router.push('/mobile')}
            className="p-2 -ml-2 text-[#718096] hover:text-[#FF5F5A] active:scale-95 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>

          <div className="flex items-center gap-4">
            {/* Stats Pills */}
            <div className="flex items-center gap-2 text-xs">
              <div className="px-3 py-1 bg-[#FF5F5A]/10 text-[#FF5F5A] rounded-full font-semibold">
                {myLeads} Mine
              </div>
              <div className="px-3 py-1 bg-[#F7FAFC] border border-[#E2E8F0] text-[#718096] rounded-full font-semibold">
                {available} Available
              </div>
            </div>

            {/* View Toggle */}
            <button
              onClick={() => setViewMode(viewMode === 'map' ? 'list' : 'map')}
              className="p-2 text-[#718096] hover:text-[#FF5F5A] active:scale-95 transition-all"
            >
              {viewMode === 'map' ? <List className="w-5 h-5" /> : <Navigation className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Map View - Full Screen */}
      {viewMode === 'map' && (
        <main className="flex-1 relative overflow-hidden">
          <LeadMap
            leads={goodLeads}
            currentUser={currentUser}
            onLeadClick={handleLeadSelect}
            selectedLeadId={selectedLeadId}
            assignmentMode="none"
            selectedLeadIdsForAssignment={[]}
          />

          {/* Floating Recenter Button */}
          <button
            onClick={() => window.location.reload()}
            className="absolute bottom-6 right-4 w-12 h-12 bg-white border-2 border-[#E2E8F0] rounded-full shadow-lg flex items-center justify-center text-[#FF5F5A] hover:bg-[#FF5F5A] hover:text-white active:scale-95 transition-all"
          >
            <Navigation className="w-5 h-5" />
          </button>
        </main>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <main className="flex-1 overflow-y-auto px-4 py-4">
          <div className="space-y-3">
            {goodLeads.length === 0 ? (
              <div className="text-center py-12 text-[#718096]">
                <p>No leads available</p>
              </div>
            ) : (
              goodLeads.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => handleLeadSelect(lead)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl p-4 text-left hover:border-[#FF5F5A] active:scale-98 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-[#2D3748] truncate">{lead.name}</div>
                      <div className="text-sm text-[#718096] truncate">{lead.address}</div>
                      <div className="text-xs text-[#718096] mt-1">{lead.city}, {lead.state}</div>
                    </div>
                    <div className="flex-shrink-0">
                      {lead.solarScore && (
                        <div className="px-2 py-1 bg-[#F7FAFC] border border-[#E2E8F0] rounded-lg text-xs font-semibold text-[#2D3748]">
                          ☀️ {lead.solarScore}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </main>
      )}

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
    </div>
  );
}
