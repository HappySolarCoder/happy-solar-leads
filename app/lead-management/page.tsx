'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import dynamic from 'next/dynamic';
import { ArrowLeft, Trash2, Users } from 'lucide-react';
import { getLeadsAsync, getUsersAsync, saveLeadAsync } from '@/app/utils/storage';
import { getCurrentAuthUser } from '@/app/utils/auth';
import { Lead, User, canSeeAllLeads } from '@/app/types';

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
  const [leads, setLeads] = useState<Lead[]>([]);
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

      const loadedLeads = await getLeadsAsync();
      const loadedUsers = await getUsersAsync();

      setLeads(loadedLeads);
      setUsers(loadedUsers);
      setIsLoading(false);
    }

    loadData();
  }, [router]);

  const handleUpdate = async () => {
    const loadedLeads = await getLeadsAsync();
    setLeads(loadedLeads);
    setSelectedLeads(new Set());
  };

  const handleTerritoryDrawn = (leadIds: string[]) => {
    console.log('Territory drawn, selected leads:', leadIds.length);
    setSelectedLeads(new Set(leadIds));
    setDrawingMode(false);
  };

  // Filter leads by selected user
  const filteredLeads = userFilter === 'all' 
    ? leads 
    : leads.filter(lead => lead.assignedTo === userFilter || lead.claimedBy === userFilter);

  // Get lead counts per user
  const userLeadCounts = users.map(user => ({
    user,
    count: leads.filter(lead => lead.assignedTo === user.id || lead.claimedBy === user.id).length,
  }));

  // Map center defaults to Rochester (for admin oversight or when GPS unavailable)
  // GPS location can be used via browser geolocation if needed in future
  const mapCenter: [number, number] = [43.1566, -77.6088]; // Rochester, NY

  const deselectAll = () => {
    setSelectedLeads(new Set());
  };

  const handleBulkUnclaim = async () => {
    if (selectedLeads.size === 0) return;
    
    const confirmed = confirm(
      `Are you sure you want to unclaim ${selectedLeads.size} lead(s)?`
    );
    
    if (!confirmed) return;

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
              const lead = leads.find(l => l.id === leadId);
              if (!lead) throw new Error('Lead not found');
              
              const updatedLead: Lead = {
                ...lead,
                claimedBy: undefined,
                claimedAt: undefined,
                assignedTo: undefined,
                assignedAt: undefined,
                status: 'unclaimed',
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
    if (selectedLeads.size === 0 || !assignToUser) return;
    
    const targetUser = users.find(u => u.id === assignToUser);
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
              const lead = leads.find(l => l.id === leadId);
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
      <header className="bg-white border-b border-[#E2E8F0] px-4 py-3 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push('/tools')}
              className="p-2 -ml-2 text-[#718096] hover:text-[#FF5F5A] transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-lg font-bold text-[#2D3748]">Lead Management</h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode Toggle */}
            <div className="flex gap-1 bg-[#F7FAFC] rounded-lg p-1">
              <button
                onClick={() => {
                  setMode('assign');
                  deselectAll();
                  setDrawingMode(false);
                }}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  mode === 'assign'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Assign
              </button>
              <button
                onClick={() => {
                  setMode('unclaim');
                  deselectAll();
                  setDrawingMode(false);
                }}
                className={`px-3 py-1.5 text-sm rounded-md font-medium transition-colors ${
                  mode === 'unclaim'
                    ? 'bg-white text-[#FF5F5A] shadow-sm'
                    : 'text-[#718096] hover:text-[#2D3748]'
                }`}
              >
                Unclaim
              </button>
            </div>

            <button
              onClick={() => {
                setDrawingMode(!drawingMode);
                if (drawingMode) {
                  deselectAll();
                }
              }}
              className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-colors ${
                drawingMode
                  ? 'bg-gray-200 text-[#2D3748]'
                  : 'bg-[#FF5F5A] text-white hover:bg-[#E54E49]'
              }`}
            >
              {drawingMode ? 'Cancel' : 'Draw'}
            </button>
          </div>
        </div>

        {/* User Filter */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Users className="w-4 h-4 text-[#718096]" />
            <label className="text-sm font-medium text-[#2D3748]">Filter by User</label>
          </div>
          <select
            value={userFilter}
            onChange={(e) => {
              setUserFilter(e.target.value);
              deselectAll();
            }}
            className="w-full px-4 py-2 border border-[#E2E8F0] rounded-lg focus:outline-none focus:ring-2 focus:ring-[#FF5F5A] focus:border-transparent"
          >
            <option value="all">All Users ({leads.length} leads)</option>
            {userLeadCounts
              .filter(({ count }) => count > 0)
              .map(({ user, count }) => (
                <option key={user.id} value={user.id}>
                  {user.name} ({count} leads)
                </option>
              ))}
          </select>

          {/* Assign To User (only in assign mode) */}
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
                {users.map(user => (
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
                🖊️ Draw a polygon on the map to select leads
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
                disabled={isDeleting || (mode === 'assign' && !assignToUser)}
                className={`w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  isDeleting || (mode === 'assign' && !assignToUser)
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
      </header>

      {/* Map View */}
      <div className="flex-1 relative">
        <LeadMap
          leads={filteredLeads}
          currentUser={currentUser}
          onLeadClick={(lead) => {}}
          center={mapCenter}
          assignmentMode={drawingMode ? 'territory' : 'none'}
          selectedLeadIdsForAssignment={Array.from(selectedLeads)}
          onTerritoryDrawn={handleTerritoryDrawn}
        />
      </div>

      {/* Progress Modal */}
      {isDeleting && progress.total > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-[#2D3748] mb-4">Unclaiming Leads...</h3>
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
