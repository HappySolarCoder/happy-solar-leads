'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Trash2, Users, MapPin, Pencil } from 'lucide-react';
import { getLeadsInBoundsAsync, getUsersAsync, rememberSavedLead, saveLeadAsync, upsertLeadInList, type MapBounds } from '@/app/utils/storage';
import { getAllUsers } from '@/app/utils/firestore';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads } from '@/app/types';
import { ensureUserColors } from '@/app/utils/userColors';
import { buildAssignableUsersFromPageData, isAssignableUserId } from '@/app/utils/assignableUsersFallback';
import { getTerritoriesAsync, saveTerritory, deleteTerritoryAsync } from '@/app/utils/territories';
import { Territory } from '@/app/types/territory';
import { autoAssignLeadsByTerritories } from '@/app/utils/territoryAssignment';

function viewportQuery(
  mapCenter: [number, number],
  mapZoom: number,
  mapBounds: MapBounds | null,
) {
  const latPad = 0.15 * Math.pow(2, Math.max(0, 11 - mapZoom));
  const lngPad = 0.25 * Math.pow(2, Math.max(0, 11 - mapZoom));
  return {
    south: mapBounds?.south ?? mapCenter[0] - latPad,
    north: mapBounds?.north ?? mapCenter[0] + latPad,
    west: mapBounds?.west ?? mapCenter[1] - lngPad,
    east: mapBounds?.east ?? mapCenter[1] + lngPad,
    maxLeads: mapZoom >= 15 ? 12000 : mapZoom >= 13 ? 7000 : mapZoom >= 11 ? 3500 : 2000,
  };
}

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

export default function LeadManagementPage() {
  const router = useRouter();
  const [boundsLeads, setBoundsLeads] = useState<Lead[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [selectedLeads, setSelectedLeads] = useState<Set<string>>(new Set());
  const [userFilter, setUserFilter] = useState<string>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isDeleting, setIsDeleting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [mode, setMode] = useState<'assign' | 'unclaim'>('unclaim');
  const [assignToUser, setAssignToUser] = useState<string>('');
  const [drawingMode, setDrawingMode] = useState(false);
  const [viewMode, setViewMode] = useState<'map' | 'assignments'>('map');
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [operationType, setOperationType] = useState<'assigning' | 'unclaiming' | 'deleting'>('unclaiming');
  const [mapCenter, setMapCenter] = useState<[number, number]>([43.1566, -77.6088]);
  const [mapZoom, setMapZoom] = useState(11);
  const [mapBounds, setMapBounds] = useState<MapBounds | null>(null);
  const [isPinsLoading, setIsPinsLoading] = useState(false);
  const [usersLoadError, setUsersLoadError] = useState<string | null>(null);
  const boundsLeadsRef = useRef(boundsLeads);
  boundsLeadsRef.current = boundsLeads;

  // Pins already on the map — not an unloaded full-leads array.
  const findLead = (leadId: string) =>
    boundsLeadsRef.current.find(l => l.id === leadId);

  const refreshViewportPins = async () => {
    const { south, north, west, east, maxLeads } = viewportQuery(mapCenter, mapZoom, mapBounds);
    const loaded = await getLeadsInBoundsAsync(south, north, west, east, maxLeads);
    setBoundsLeads(prev => (loaded.length > 0 ? loaded : prev));
  };

  // Debug logging
  useEffect(() => {
    console.log('[Lead Management] State updated:', {
      viewMode,
      territoriesCount: territories.length,
      territories,
    });
  }, [viewMode, territories]);

  useEffect(() => {
    async function loadData() {
      const user = await getCurrentAuthUser();
      if (!user) {
        router.push('/login');
        return;
      }

      // Check permission - managers and admins only
      if (!canSeeAllLeads(user.role)) {
        router.push('/mobile/knocking');
        return;
      }

      setCurrentUser(user);

      // Users for Assign To / Filter. Do not restore storage.ts import-time
      // getUsersAsync/getLeadsAsync — that was the field-perf slowness.
      // Map pins stay viewport-scoped via getLeadsInBoundsAsync below.
      let loadedUsers: User[] = [];
      try {
        loadedUsers = await getUsersAsync();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[Lead Management] getUsersAsync failed:', error);
        setUsersLoadError(message);
      }

      if (loadedUsers.length === 0) {
        try {
          loadedUsers = await getAllUsers();
          if (loadedUsers.length > 0) setUsersLoadError(null);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error('[Lead Management] getAllUsers retry failed:', error);
          setUsersLoadError(message);
        }
      }

      const loadedTerritories = await getTerritoriesAsync();

      if (loadedUsers.length === 0) {
        const fallbackUsers = buildAssignableUsersFromPageData(user, loadedTerritories, []);
        console.warn('[Lead Management] users collection empty; using on-page fallback', {
          fallbackUsers: fallbackUsers.length,
          territories: loadedTerritories.length,
        });
      }

      console.log('[Lead Management] Loaded data:', {
        users: loadedUsers.length,
        territories: loadedTerritories.length,
      });
      console.log('[Lead Management] Territories:', loadedTerritories);

      setUsers(loadedUsers);
      setTerritories(loadedTerritories);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  const handleUpdate = async () => {
    // Keep selections in sync. Refresh territories + viewport pins only —
    // do not dump getLeadsAsync() / all leads onto this page.
    setSelectedLeads(new Set());
    const loadedTerritories = await getTerritoriesAsync();
    setTerritories(loadedTerritories);
    await refreshViewportPins();
  };

  const handleLeadAdded = (lead: Lead) => {
    rememberSavedLead(lead);
    setBoundsLeads((prev) => upsertLeadInList(prev, lead));
  };

  const handleTerritoryDrawn = async (leadIds: string[], polygon: [number, number][]) => {
    console.log('Territory drawn, leads inside:', leadIds.length);
    setSelectedLeads(new Set(leadIds));
    setDrawingMode(false);

    // In assign mode, save the territory polygon and auto-assign leads
    if (mode === 'assign' && isAssignableUserId(assignToUser) && polygon.length >= 3) {
      const user = activeAssignableUsers.find(u => u.id === assignToUser);
      if (user) {
        setOperationType('assigning');
        try {
          // Show progress while saveTerritory runs so a hang is not a silent grey button.
          setProgress({ current: 0, total: leadIds.length });
          setIsDeleting(true);

          // Convert polygon to Firestore-compatible format
          const polygonObjects = polygon.map(([lat, lng]) => ({ lat, lng }));
          
          // 1. Save the territory first
          await saveTerritory({
            userId: user.id,
            userName: user.name,
            userColor: user.color || '#6b7280',
            polygon: polygonObjects,
            leadIds,
            createdAt: new Date(),
            createdBy: currentUser?.id || 'unknown',
          });
          
          console.log('Territory saved to Firestore');

          // 2. Auto-assign all leads inside the territory
          const leadsToAssign = leadIds.length;
          setProgress({ current: 0, total: leadsToAssign });

          let processed = 0;
          const batchSize = 30;

          for (let i = 0; i < leadIds.length; i += batchSize) {
            const batch = leadIds.slice(i, i + batchSize);
            
            await Promise.all(
              batch.map(async (leadId) => {
                try {
                  const lead = findLead(leadId);
                  if (!lead) return;
                  
                  // Preserve existing status, only assign if not already claimed
                  const updatedLead: Lead = {
                    ...lead,
                    assignedTo: user.id,
                    assignedAt: new Date(),
                    // Only set status to 'assigned' if lead is unclaimed
                    ...(lead.status === 'unclaimed' ? { status: 'assigned' } : {}),
                  };
                  
                  await saveLeadAsync(updatedLead);
                  processed++;
                } catch (err) {
                  console.error(`Failed to assign lead ${leadId}:`, err);
                }
              })
            );

            setProgress({ current: processed, total: leadsToAssign });

            if (i + batchSize < leadIds.length) {
              await new Promise(resolve => setTimeout(resolve, 200));
            }
          }

          // 3. Patch pins already in view, then refresh territories + viewport
          const assignedIdSet = new Set(leadIds);
          const assignedAt = new Date();
          setBoundsLeads(prev => prev.map(lead => (
            assignedIdSet.has(lead.id)
              ? {
                  ...lead,
                  assignedTo: user.id,
                  assignedAt,
                  ...(lead.status === 'unclaimed' ? { status: 'assigned' } : {}),
                }
              : lead
          )));
          const loadedTerritories = await getTerritoriesAsync();
          setTerritories(loadedTerritories);
          await handleUpdate();
          
          alert(`Territory created! Assigned ${processed} leads to ${user.name}.`);
        } catch (error) {
          console.error('Failed to save territory:', error);
          alert('Failed to create territory. Please try again.');
        } finally {
          setIsDeleting(false);
          setProgress({ current: 0, total: 0 });
        }
      }
    }
  };

  // Lazy-load pins by viewport bounds (fast even at 200k total leads).
  // Wait for currentUser — getLeadsInBoundsAsync returns [] when auth is not ready,
  // and a Leaflet moveend at the same default center/zoom will not refetch.
  useEffect(() => {
    if (!currentUser) return;
    let isCanceled = false;
    const t = setTimeout(async () => {
      try {
        setIsPinsLoading(true);
        const { south, north, west, east, maxLeads } = viewportQuery(mapCenter, mapZoom, mapBounds);
        const loaded = await getLeadsInBoundsAsync(south, north, west, east, maxLeads);
        if (isCanceled) return;
        // Empty fetch must not wipe pins that already loaded (auth/query miss).
        setBoundsLeads(prev => (loaded.length > 0 ? loaded : prev));
      } catch (e) {
        console.error('[Lead Management] Failed loading pins in bounds', e);
      } finally {
        if (!isCanceled) setIsPinsLoading(false);
      }
    }, 450);

    return () => {
      isCanceled = true;
      clearTimeout(t);
    };
  }, [currentUser, mapCenter, mapZoom, mapBounds]);

  // If getAllUsers stayed empty, keep Assign To / Filter names from data
  // already on the page (currentUser + visible territories + viewport pins).
  const sourceUsers = users.length > 0
    ? users
    : buildAssignableUsersFromPageData(currentUser, territories, boundsLeads);

  const activeAssignableUsers = sourceUsers.filter(u => {
    const ux = u as any;
    return isAssignableUserId(u.id) && !ux.deleted && ux.isActive !== false;
  });

  // Filter pins currently loaded for the viewport (fast)
  const filteredLeads = userFilter === 'all'
    ? boundsLeads
    : boundsLeads.filter(lead => lead.assignedTo === userFilter || lead.claimedBy === userFilter);

  // Counts from viewport pins so Filter/Assign To do not depend on the empty
  // module cache or an unfetched full-admin lead dump.
  const userLeadCounts = activeAssignableUsers.map(user => ({
    user,
    count: boundsLeads.filter(lead => lead.assignedTo === user.id || lead.claimedBy === user.id).length,
  }));

  // Map center defaults to Rochester (for admin oversight or when GPS unavailable)
  // GPS location can be used via browser geolocation if needed in future

  const deselectAll = () => {
    setSelectedLeads(new Set());
  };

  const handleTerritoryDelete = async (territoryId: string) => {
    const territory = territories.find(t => t.id === territoryId);
    if (!territory) return;

    setOperationType('deleting');
    setIsDeleting(true);
    setProgress({ current: 0, total: territory.leadIds.length });

    try {
      // 1. Unassign all leads in this territory (but preserve disposition history)
      let processed = 0;
      const batchSize = 30;

      for (let i = 0; i < territory.leadIds.length; i += batchSize) {
        const batch = territory.leadIds.slice(i, i + batchSize);
        
        await Promise.all(
          batch.map(async (leadId) => {
            try {
              const lead = findLead(leadId);
              if (!lead) return;
              
              // Unassign but keep disposition, dispositionHistory, and all other data
              // Preserve the actual disposition status (not generic 'dispositioned')
              const updatedLead: Lead = {
                ...lead,
                assignedTo: undefined,
                assignedAt: undefined,
                status: lead.disposition || lead.status, // Keep actual disposition or current status
                // Explicitly preserve disposition data
                disposition: lead.disposition,
                dispositionedAt: lead.dispositionedAt,
                dispositionHistory: lead.dispositionHistory,
              };
              
              await saveLeadAsync(updatedLead);
              processed++;
            } catch (err) {
              console.error(`Failed to unassign lead ${leadId}:`, err);
            }
          })
        );

        setProgress({ current: processed, total: territory.leadIds.length });

        if (i + batchSize < territory.leadIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      // 2. Delete the territory
      await deleteTerritoryAsync(territoryId);

      // 3. Reload data
      await handleUpdate();

      alert(`Territory deleted. Unassigned ${processed} leads.\n\nLead history and dispositions have been preserved.`);
    } catch (error) {
      console.error('Failed to delete territory:', error);
      alert('Failed to delete territory. Please try again.');
    } finally {
      setIsDeleting(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleBulkUnclaim = async () => {
    if (selectedLeads.size === 0) return;
    
    const confirmed = confirm(
      `Are you sure you want to unclaim ${selectedLeads.size} lead(s)?`
    );
    
    if (!confirmed) return;

    setOperationType('unclaiming');
    setIsDeleting(true);
    const leadIds = Array.from(selectedLeads);
    setProgress({ current: 0, total: leadIds.length });

    try {
      const batchSize = 30; // Reduced batch size for better reliability
      let processed = 0;
      let failed = 0;

      // Process in batches to avoid rate limits
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const batch = leadIds.slice(i, i + batchSize);
        
        // Process batch with individual error handling
        const results = await Promise.allSettled(
          batch.map(async (leadId) => {
            try {
              const lead = findLead(leadId);
              if (!lead) throw new Error('Lead not found');
              
              // Preserve the last disposition status if lead was knocked
              // Only change to 'unclaimed' if it was never knocked (status was 'assigned' or 'unclaimed')
              const wasNeverKnocked = lead.status === 'assigned' || lead.status === 'unclaimed';
              const newStatus = wasNeverKnocked ? 'unclaimed' : lead.status;
              
              const updatedLead: Lead = {
                ...lead,
                claimedBy: undefined,
                claimedAt: undefined,
                assignedTo: undefined,
                assignedAt: undefined,
                status: newStatus,
              };
              
              await saveLeadAsync(updatedLead);
              return true;
            } catch (err) {
              console.error(`Failed to unclaim lead ${leadId}:`, err);
              return false;
            }
          })
        );

        // Count successes and failures
        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            processed++;
          } else {
            failed++;
          }
        });

        // Update progress
        setProgress({ current: processed + failed, total: leadIds.length });

        // Delay between batches (increased to 200ms for reliability)
        if (i + batchSize < leadIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      await handleUpdate();
      
      if (failed > 0) {
        alert(`Unclaimed ${processed} lead(s). ${failed} failed - please try those again.`);
      } else {
        alert(`Successfully unclaimed all ${processed} lead(s)!`);
      }
    } catch (error) {
      console.error('Error unclaiming leads:', error);
      alert('Operation failed. Please try again.');
    } finally {
      setIsDeleting(false);
      setDrawingMode(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  const handleBulkAssign = async () => {
    if (selectedLeads.size === 0 || !isAssignableUserId(assignToUser)) return;
    
    const targetUser = activeAssignableUsers.find(u => u.id === assignToUser);
    if (!targetUser) return;

    const confirmed = confirm(
      `Assign ${selectedLeads.size} lead(s) to ${targetUser.name}?`
    );
    
    if (!confirmed) return;

    setIsDeleting(true);
    const leadIds = Array.from(selectedLeads);
    setProgress({ current: 0, total: leadIds.length });

    try {
      const batchSize = 30;
      let processed = 0;
      let failed = 0;

      for (let i = 0; i < leadIds.length; i += batchSize) {
        const batch = leadIds.slice(i, i + batchSize);
        
        const results = await Promise.allSettled(
          batch.map(async (leadId) => {
            try {
              const lead = findLead(leadId);
              if (!lead) throw new Error('Lead not found');
              
              const updatedLead: Lead = {
                ...lead,
                assignedTo: assignToUser,
                assignedAt: new Date(),
                status: 'assigned',
              };
              
              await saveLeadAsync(updatedLead);
              return true;
            } catch (err) {
              console.error(`Failed to assign lead ${leadId}:`, err);
              return false;
            }
          })
        );

        results.forEach(result => {
          if (result.status === 'fulfilled' && result.value) {
            processed++;
          } else {
            failed++;
          }
        });

        setProgress({ current: processed + failed, total: leadIds.length });

        if (i + batchSize < leadIds.length) {
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      await handleUpdate();
      
      if (failed > 0) {
        alert(`Assigned ${processed} lead(s). ${failed} failed - please try those again.`);
      } else {
        alert(`Successfully assigned all ${processed} lead(s) to ${targetUser.name}!`);
      }
    } catch (error) {
      console.error('Error assigning leads:', error);
      alert('Operation failed. Please try again.');
    } finally {
      setIsDeleting(false);
      setDrawingMode(false);
      setProgress({ current: 0, total: 0 });
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F7FAFC] flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#FF5F5A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-[#718096]">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-white overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b border-[#E2E8F0] px-2 py-3 flex-shrink-0">
        <div className="flex flex-col items-center gap-2">
          {/* Top Row: Back + Title + Logo */}
          <div className="flex items-center justify-between w-full">
            <button
              onClick={() => router.push('/tools')}
              className="p-2 text-[#718096] hover:text-[#FF5F5A] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-[#2D3748]">Lead Management</h1>
            <img 
              src="/raydar-icon.png" 
              alt="Raydar" 
              className="h-8 w-8 object-contain"
            />
          </div>

          {/* View Mode Toggle */}
          <div className="flex gap-1 bg-[#F7FAFC] rounded-lg p-1">
            <button
              onClick={() => setViewMode('map')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'map'
                  ? 'bg-white text-[#FF5F5A] shadow-sm'
                  : 'text-[#718096] hover:text-[#2D3748]'
              }`}
            >
              <MapPin className="w-4 h-4" />
              <span className="hidden xs:inline">Map</span>
            </button>
            <button
              onClick={() => setViewMode('assignments')}
              className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors flex items-center gap-1 ${
                viewMode === 'assignments'
                  ? 'bg-white text-[#FF5F5A] shadow-sm'
                  : 'text-[#718096] hover:text-[#2D3748]'
              }`}
            >
              <Users className="w-4 h-4" />
              <span className="hidden xs:inline">Assignments</span>
            </button>
          </div>

          {/* Mode Toggle (only show in assignments view) */}
          {viewMode === 'assignments' && (
            <div className="flex gap-1 bg-[#F7FAFC] rounded-lg p-1">
              <button
                onClick={() => {
                  setMode('assign');
                  deselectAll();
                  setDrawingMode(false);
                }}
                className={`px-2 py-1.5 text-xs sm:text-sm rounded-md font-medium transition-colors whitespace-nowrap ${
                  mode === 'assign'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Assign Territory
              </button>
              <button
                onClick={() => {
                  setMode('unclaim');
                  deselectAll();
                  setDrawingMode(false);
                }}
                className={`px-2 py-1.5 text-xs sm:text-sm rounded-md font-medium transition-colors whitespace-nowrap ${
                  mode === 'unclaim'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Remove Territory
              </button>
              <button
                onClick={() => {
                  setDrawingMode(!drawingMode);
                  if (drawingMode) deselectAll();
                }}
                className={`px-2 py-1.5 text-xs sm:text-sm rounded-lg font-medium transition-colors whitespace-nowrap ${
                  drawingMode
                    ? 'bg-gray-200 text-[#2D3748]'
                    : 'bg-[#FF5F5A] text-white hover:bg-[#E54E49]'
                }`}
              >
                {drawingMode ? 'Cancel' : 'Draw'}
              </button>
            </div>
          )}
        </div>

        {/* Floating Draw Button - Mobile */}
        {viewMode === 'assignments' && (
          <button
            onClick={() => {
              setDrawingMode(!drawingMode);
              if (drawingMode) deselectAll();
            }}
            className="fixed bottom-6 right-6 z-50 sm:hidden bg-[#FF5F5A] hover:bg-[#E54E49] text-white rounded-full p-4 shadow-lg"
          >
            <Pencil className="w-6 h-6" />
          </button>
        )}

        {/* User Filter (only show in assignments view when drawing/managing) */}
        {viewMode === 'assignments' && (
          <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-[#718096]" />
            <label className="text-sm font-medium text-[#2D3748]">Filter by User</label>
          </div>
          {usersLoadError && (
            <p className="text-sm text-red-600" role="alert">
              Could not load users: {usersLoadError}. Assign To / Filter are using names already on this page.
            </p>
          )}
          <select
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              deselectAll();
            }}
            className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
          >
            <option value="all">All Users ({boundsLeads.length} leads in view)</option>
            {userLeadCounts
              .map(({ user, count }) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({count} leads)
                </option>
              ))}
          </select>

          {/* Assign To lists sourceUsers as soon as Assign Territory is clicked.
              Same names as Filter — no need to open Filter first. */}
          {mode === 'assign' && (
            <div className="mt-2">
              <label className="block text-sm font-medium text-[#2D3748] mb-2">
                Assign To
              </label>
              <select
                value={assignToUser}
                onChange={(e) => setAssignToUser(e.target.value)}
                className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
              >
                <option value="">Select User...</option>
                {activeAssignableUsers.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Drawing Instructions */}
          {drawingMode && (
            <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-800 font-medium">
                🖋️ Draw a polygon on the map to select leads
              </p>
              <p className="text-xs text-blue-600 mt-1">
                Click to add points, double-click to finish
              </p>
            </div>
          )}

          {/* Selected Leads Count & Action Button */}
          {selectedLeads.size > 0 && (
            <div className="mt-2 space-y-2">
              <div className="flex items-center justify-between p-2 bg-[#F7FAFC] rounded-lg">
                <span className="text-sm font-medium text-[#2D3748]">
                  {selectedLeads.size} lead{selectedLeads.size !== 1 ? 's' : ''} selected
                </span>
                <button
                  onClick={deselectAll}
                  className="text-sm text-[#718096] hover:text-[#2D3748] font-medium"
                >
                  Clear
                </button>
              </div>

              <button
                onClick={mode === 'assign' ? handleBulkAssign : handleBulkUnclaim}
                disabled={isDeleting || (mode === 'assign' && !isAssignableUserId(assignToUser))}
                className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  isDeleting || (mode === 'assign' && !isAssignableUserId(assignToUser))
                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'bg-[#FF5F5A] text-white hover:bg-[#E54E49]'
                }`}
              >
                {mode === 'assign' ? (
                  <>
                    <Users className="w-4 h-4" />
                    Assign {selectedLeads.size} Lead{selectedLeads.size !== 1 ? 's' : ''}
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Unclaim {selectedLeads.size} Lead{selectedLeads.size !== 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          )}
          </div>
        )}
      </header>

      {/* Map View */}
      <div className="flex-1 relative">
        <LeadMap
          leads={filteredLeads}
          currentUser={currentUser}
          users={ensureUserColors(sourceUsers)}
          onLeadClick={(lead) => {}}
          center={mapCenter}
          zoom={mapZoom}
          onMapMove={(center, zoom, bounds) => {
            setMapCenter(center);
            setMapZoom(zoom);
            if (bounds) setMapBounds(bounds);
          }}
          assignmentMode={drawingMode ? 'territory' : 'none'}
          selectedLeadIdsForAssignment={Array.from(selectedLeads)}
          onTerritoryDrawn={handleTerritoryDrawn}
          viewMode={viewMode}
          territories={territories}
          onTerritoryDelete={handleTerritoryDelete}
          onLeadAdded={handleLeadAdded}
        />
      </div>

      {/* Progress Modal */}
      {isDeleting && progress.total > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-[#2D3748] mb-4">
              {operationType === 'assigning' && 'Assigning Leads...'}
              {operationType === 'unclaiming' && 'Unclaiming Leads...'}
              {operationType === 'deleting' && 'Deleting Territory...'}
            </h3>
            <div className="mb-2">
              <div className="w-full bg-[#E2E8F0] rounded-full h-3 overflow-hidden">
                <div
                  className="h-full bg-[#FF5F5A] transition-all duration-300"
                  style={{ width: `${(progress.current / progress.total) * 100}%` }}
                />
              </div>
            </div>
            <p className="text-sm text-[#718096] text-center">
              {progress.current} of {progress.total} leads processed
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
