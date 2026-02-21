'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, List, Navigation, Filter, MapPin, Settings } from 'lucide-react';
import { getLeadsAsync, getUsersAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads, canAssignLeads } from '@/app/types';
import LeadDetail from '@/app/components/LeadDetail';
import { useGeolocation, calculateDistance, formatDistance } from '@/app/hooks/useGeolocation';
import { getDispositionsAsync } from '@/app/utils/dispositions';

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
  const [mapCenter, setMapCenter] = useState<[number, number] | undefined>(undefined);
  const [hasInitializedMap, setHasInitializedMap] = useState(false);
  const [solarFilter, setSolarFilter] = useState<'all' | 'solid' | 'good' | 'great'>('all');
  const [dispositionFilter, setDispositionFilter] = useState<string>('all');
  const [setterFilter, setSetterFilter] = useState<string>('all');
  const [showFilters, setShowFilters] = useState(false);
  const [dispositions, setDispositions] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);

  // GPS tracking - continuous updates
  const { position: gpsPosition, error: gpsError, isLoading: gpsLoading } = useGeolocation({
    enableHighAccuracy: true,
    watch: true, // Continuous tracking
  });

  // Set map center based on user role
  useEffect(() => {
    if (!currentUser || hasInitializedMap) return;
    
    // Admins/Managers: center on Rochester for oversight
    if (currentUser.role === 'admin' || currentUser.role === 'manager') {
      setMapCenter([43.1566, -77.6088]); // Rochester, NY
      setHasInitializedMap(true);
    }
    // Setters/Closers: center on GPS for field work
    else if (gpsPosition) {
      setMapCenter([gpsPosition.lat, gpsPosition.lng]);
      setHasInitializedMap(true);
    }
  }, [gpsPosition, currentUser, hasInitializedMap]);

  // Load data
  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }
      if (user.approvalStatus === 'pending') {
        router.push('/pending-approval');
        return;
      }
      setCurrentUser(user);

      const loadedLeads = await getLeadsAsync();
      setLeads(loadedLeads);
      setIsLoading(false);
    }
    loadData();
  }, [router]);
  
  // Load dispositions and users
  useEffect(() => {
    getDispositionsAsync().then(setDispositions);
    getUsersAsync().then(setUsers);
  }, []);

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

  // Role-based visibility: setters/closers only see their assigned leads
  const roleFilteredLeads = currentUser
    ? (currentUser.role === 'setter' || currentUser.role === 'closer')
      ? leads.filter(l => l.claimedBy === currentUser.id)
      : leads
    : [];

  // Exclude poor solar leads
  let goodLeads = roleFilteredLeads.filter(l => l.solarCategory !== 'poor');
  
  // Filter by setter if selected (Admin/Manager only)
  if (setterFilter !== 'all') {
    goodLeads = goodLeads.filter(l => l.claimedBy === setterFilter);
  }
  
  // Filter by solar category if selected
  if (solarFilter !== 'all') {
    goodLeads = goodLeads.filter(l => l.solarCategory === solarFilter);
  }
  
  // Filter by disposition if selected
  if (dispositionFilter !== 'all') {
    goodLeads = goodLeads.filter(l => l.disposition === dispositionFilter);
  }

  // Calculate distances and sort by nearest if GPS available
  const leadsWithDistance = goodLeads.map(lead => ({
    ...lead,
    distance: gpsPosition && lead.lat && lead.lng
      ? calculateDistance(gpsPosition.lat, gpsPosition.lng, lead.lat, lead.lng)
      : undefined,
  })).sort((a, b) => {
    // Sort by distance (nearest first), then by status
    if (a.distance !== undefined && b.distance !== undefined) {
      return a.distance - b.distance;
    }
    return 0;
  });

  // Get selected lead
  const selectedLead = leads.find(l => l.id === selectedLeadId);

  // Helper: Calculate compass direction from user to lead
  function getDirection(userLat: number, userLng: number, leadLat: number, leadLng: number): string {
    const angle = Math.atan2(leadLng - userLng, leadLat - userLat) * 180 / Math.PI;
    const normalized = (angle + 360) % 360;
    
    if (normalized >= 337.5 || normalized < 22.5) return 'N';
    if (normalized >= 22.5 && normalized < 67.5) return 'NE';
    if (normalized >= 67.5 && normalized < 112.5) return 'E';
    if (normalized >= 112.5 && normalized < 157.5) return 'SE';
    if (normalized >= 157.5 && normalized < 202.5) return 'S';
    if (normalized >= 202.5 && normalized < 247.5) return 'SW';
    if (normalized >= 247.5 && normalized < 292.5) return 'W';
    return 'NW';
  }

  // Stats: Next Best Lead (nearest high-quality lead in current view)
  const prioritizedLeads = leadsWithDistance.filter(l => 
    l.solarCategory && 
    ['solid', 'good', 'great'].includes(l.solarCategory)
  );
  const nextBest = prioritizedLeads.length > 0 ? prioritizedLeads[0] : null;
  const nextBestDistanceRaw = nextBest?.distance;
  const nextBestDistance = nextBestDistanceRaw !== undefined 
    ? nextBestDistanceRaw < 0.1 
      ? `${Math.round(nextBestDistanceRaw * 5280)} ft`
      : nextBestDistanceRaw > 25 
        ? `${Math.round(nextBestDistanceRaw)} mi`
        : `${nextBestDistanceRaw.toFixed(1)} mi`
    : null;
  const nextBestDirection = nextBest && gpsPosition 
    ? getDirection(gpsPosition.lat, gpsPosition.lng, nextBest.lat!, nextBest.lng!)
    : null;
  const nextBestIsFar = (nextBestDistanceRaw || 0) > 50;

  // Stats: Today's Knocks (leads dispositioned today by current user)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todaysKnocks = leads.filter(l => 
    l.dispositionedAt && 
    l.dispositionedAt >= todayStart &&
    l.claimedBy === currentUser?.id
  ).length;

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
            {/* Field-Optimized Stats */}
            <div className="flex items-center gap-2 text-xs">
              {/* Next Best Lead */}
              <button
                onClick={() => {
                  if (nextBest) {
                    handleLeadSelect(nextBest);
                  }
                }}
                disabled={!nextBest}
                className={`min-w-[120px] max-w-[140px] px-3 py-1 rounded-full font-semibold transition-all ${
                  nextBest
                    ? 'bg-gradient-to-r from-[#FF5F5A] to-[#FF7A6B] text-white shadow-sm active:scale-95'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {nextBest ? (
                  <div className="flex flex-col leading-tight text-left whitespace-nowrap">
                    <span className="text-[10px] uppercase tracking-wide opacity-80">Nearest 3⭐</span>
                    <span className="text-sm">
                      {nextBestIsFar ? 'Far Away' : nextBestDistance}
                      {nextBestDirection ? ` ${nextBestDirection}` : ''}
                    </span>
                  </div>
                ) : (
                  <span className="text-sm">3⭐ Not Found</span>
                )}
              </button>
              
              {/* Today's Knocks */}
              <div className="px-3 py-1 bg-[#F7FAFC] border border-[#E2E8F0] text-[#718096] rounded-full font-semibold">
                🚪 {todaysKnocks} Today
              </div>
            </div>

            {/* Filter Toggle */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-2 transition-all ${showFilters ? 'text-[#FF5F5A]' : 'text-[#718096] hover:text-[#FF5F5A]'} active:scale-95`}
            >
              <Filter className="w-5 h-5" />
            </button>

            {/* Tools Button */}
            <button
              onClick={() => router.push('/tools')}
              className="p-2 text-[#718096] hover:text-[#FF5F5A] active:scale-95 transition-all"
            >
              <Settings className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Filters Panel */}
        {showFilters && (
          <div className="px-4 py-3 border-t border-[#E2E8F0] bg-[#F7FAFC]">
            {/* Setter Filter - Admin/Manager only */}
            {currentUser && canSeeAllLeads(currentUser.role) && (
              <div className="mb-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-base">👥</span>
                  <label className="text-xs font-semibold text-[#2D3748]">
                    Filter by Setter
                  </label>
                </div>
                <select
                  value={setterFilter}
                  onChange={(e) => setSetterFilter(e.target.value)}
                  className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
                >
                  <option value="all">All Setters</option>
                  {users.map(user => (
                    <option key={user.id} value={user.id}>
                      {user.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            
            {/* Solar Score Filter */}
            <div className="flex items-center gap-2 mb-2">
              <span className="text-base">☀️</span>
              <label className="text-xs font-semibold text-[#2D3748]">
                Solar Score Filter
              </label>
            </div>
            <select
              value={solarFilter}
              onChange={(e) => setSolarFilter(e.target.value as 'all' | 'solid' | 'good' | 'great')}
              className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
            >
              <option value="all">All Solar Scores</option>
              <option value="solid">⭐ Solid (60-74)</option>
              <option value="good">⭐⭐ Good (75-84)</option>
              <option value="great">⭐⭐⭐ Great (85+)</option>
            </select>
            
            {/* Disposition Filter */}
            <div className="mt-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-base">📋</span>
                <label className="text-xs font-semibold text-[#2D3748]">
                  Disposition Filter
                </label>
              </div>
              <select
                value={dispositionFilter}
                onChange={(e) => setDispositionFilter(e.target.value)}
                className="w-full px-3 py-2 bg-white border border-[#E2E8F0] rounded-lg text-sm font-medium text-[#2D3748] focus:outline-none focus:border-[#FF5F5A] focus:ring-2 focus:ring-[#FF5F5A]/10"
              >
                <option value="all">All Dispositions</option>
                {dispositions.map(dispo => (
                  <option key={dispo.id} value={dispo.name}>
                    {dispo.emoji} {dispo.name}
                  </option>
                ))}
              </select>
            </div>
            
            {/* Apply Button - Closes filter panel */}
            <button
              onClick={() => setShowFilters(false)}
              className="w-full mt-4 px-4 py-3 bg-gradient-to-r from-[#FF5F5A] to-[#FF7A6B] text-white font-semibold rounded-xl shadow-sm active:scale-95 transition-transform"
            >
              Apply Filters
            </button>
          </div>
        )}
      </header>

      {/* Map View - Full Screen */}
      {viewMode === 'map' && (
        <main className="flex-1 relative overflow-hidden">
          <LeadMap
            leads={leadsWithDistance}
            currentUser={currentUser}
            onLeadClick={handleLeadSelect}
            selectedLeadId={selectedLeadId}
            assignmentMode="none"
            selectedLeadIdsForAssignment={[]}
            userPosition={gpsPosition ? [gpsPosition.lat, gpsPosition.lng] : undefined}
            center={mapCenter} // Set ONCE on GPS load, then only on manual recenter
            zoom={15} // Closer zoom for mobile
          />
          {/* GPS Locate button is now built into LeadMap component */}
        </main>
      )}

      {/* List View */}
      {viewMode === 'list' && (
        <main className="flex-1 overflow-y-auto px-4 py-4">
          {/* GPS Status */}
          {gpsLoading && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-800 flex items-center gap-2">
              <div className="w-3 h-3 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              Getting your location...
            </div>
          )}
          {gpsError && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
              📍 Location disabled - Enable GPS for distance sorting
            </div>
          )}
          
          <div className="space-y-3">
            {leadsWithDistance.length === 0 ? (
              <div className="text-center py-12 text-[#718096]">
                <p>No leads available</p>
              </div>
            ) : (
              leadsWithDistance.map(lead => (
                <button
                  key={lead.id}
                  onClick={() => handleLeadSelect(lead)}
                  className="w-full bg-white border border-[#E2E8F0] rounded-xl p-4 text-left hover:border-[#FF5F5A] active:scale-98 transition-all"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <div className="font-semibold text-[#2D3748] truncate">{lead.name}</div>
                        {lead.distance !== undefined && (
                          <span className="text-xs font-semibold text-[#FF5F5A] flex-shrink-0">
                            📍 {formatDistance(lead.distance)}
                          </span>
                        )}
                      </div>
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
